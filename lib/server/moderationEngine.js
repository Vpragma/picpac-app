// Проверка фото на сервере (N4): те же модели и то же ядро, что на устройстве (lib/photo/moderationModel.js),
// но клиент здесь ничего не решает — сервер сам читает файл из нашего хранилища и считает оценки.
// Без "server-only": модуль запускают и скрипты (scripts/moderation-eval.mjs). Клиентский код его не импортирует.
//
// Модели: локально — из public/ на диске; на Vercel файлов public/ в функции нет — берём со своего же развёртывания
// (https://$VERCEL_URL/models/moderation/…, это наш сайт, не сторонний сервис) и сверяем SHA-256.
// onnxruntime-web (wasm, один поток) — без нативных библиотек: функция Vercel остаётся маленькой.
// Картинка: sharp (поворот по EXIF, прозрачность → белый фон, уменьшение) → 384×384 и 224×224.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import * as ort from "onnxruntime-web";
import { CLIP_MODEL, CLIP_SIZE, CLIP_TEXT, NSFW_MODEL, NSFW_SIZE, clipCategories, clipInput, moderationScores, nsfwInput, nsfwProb } from "../photo/moderationModel.js";

let engine = null; // Promise<{ nsfw, clip, text }>
let chain = Promise.resolve(); // одно фото за раз: wasm однопоточный, память функции ограничена

async function loadFile(meta) {
  try {
    return await readFile(join(process.cwd(), "public", meta.path));
  } catch {
    // нет на диске — берём со своего развёртывания
  }
  const host = process.env.VERCEL_URL;
  if (!host) throw new Error("model_missing:" + meta.path);
  const res = await fetch(`https://${host}${meta.path}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`model_http_${res.status}:${meta.path}`);
  return Buffer.from(await res.arrayBuffer());
}

async function loadModel(meta) {
  const bytes = await loadFile(meta);
  if (meta.sha256 && createHash("sha256").update(bytes).digest("hex") !== meta.sha256) throw new Error("model_checksum:" + meta.path);
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}

export function loadEngine() {
  engine ??= (async () => {
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = "error";
    const [nsfw, clip, textBytes] = await Promise.all([loadModel(NSFW_MODEL), loadModel(CLIP_MODEL), loadFile(CLIP_TEXT)]);
    return { nsfw, clip, text: JSON.parse(textBytes.toString("utf8")) };
  })().catch((e) => {
    engine = null;
    throw e;
  });
  return engine;
}

// Пиксели для обеих моделей из файла (JPEG/PNG до 100 Мп): поворот по EXIF, прозрачность на белом, уменьшение
export async function preparePixels(input) {
  const base = await sharp(input, { failOn: "none", limitInputPixels: 120_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const raw = { raw: { width: base.info.width, height: base.info.height, channels: base.info.channels } };
  const [a, b] = await Promise.all([
    sharp(base.data, raw).resize(NSFW_SIZE, NSFW_SIZE, { fit: "fill", kernel: "cubic" }).raw().toBuffer(),
    sharp(base.data, raw).resize(CLIP_SIZE, CLIP_SIZE, { fit: "cover", position: "centre", kernel: "cubic" }).raw().toBuffer(),
  ]);
  return { nsfwPx: a, clipPx: b, channels: base.info.channels };
}

async function run(input) {
  const { nsfw, clip, text } = await loadEngine();
  const { nsfwPx, clipPx, channels } = await preparePixels(input);
  const o1 = await nsfw.run({ [nsfw.inputNames[0]]: new ort.Tensor("float32", nsfwInput(nsfwPx, channels), [1, 3, NSFW_SIZE, NSFW_SIZE]) });
  const o2 = await clip.run({ [clip.inputNames[0]]: new ort.Tensor("float32", clipInput(clipPx, channels), [1, 3, CLIP_SIZE, CLIP_SIZE]) });
  return moderationScores(nsfwProb(o1[nsfw.outputNames[0]].data), clipCategories(o2[clip.outputNames[0]].data, text));
}

// Оценки для файла фото (Buffer/Uint8Array) → { v, nsfw, breast, nude, sex, nazi, weapon, blood, drugs }
export function scoreImage(input) {
  const next = chain.then(() => run(input));
  chain = next.catch(() => null);
  return next;
}
