// Проверка фото на сервере (N4): те же модели и то же ядро, что на устройстве (lib/photo/moderationModel.js),
// но клиент здесь ничего не решает — сервер сам читает файл из нашего хранилища и считает оценки.
// Без "server-only": модуль запускают и скрипты (scripts/moderation-eval.mjs). Клиентский код его не импортирует.
//
// Модели: с диска (public/models/moderation; на Vercel сборка кладёт эту папку в функцию — next.config.mjs),
// если файла нет — со своего же развёртывания (https://$VERCEL_URL/models/moderation/…, наш сайт, не сторонний
// сервис). SHA-256 сверяется в обоих случаях.
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

// Папка моделей на диске. Путь узкий нарочно: сборка (трассировка файлов) кладёт в функцию только эту папку,
// а не весь public/ (там модели редактора ещё на 60+ МБ).
const DIR = join(process.cwd(), "public", "models", "moderation");

async function loadFile(meta) {
  try {
    return await readFile(join(DIR, meta.path.split("/").pop()));
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

// Пиксели для обеих моделей из файла (JPEG/PNG до 100 Мп): поворот по EXIF, прозрачность на белом, уменьшение.
// CLIP видит квадрат: центр — как на устройстве; у вытянутого кадра (сторона больше другой в 1,2 раза) сервер
// смотрит ещё два квадрата у краёв, чтобы символ или оружие сбоку не выпали из кадра (crops: 3, ≈ +0,6 с на фото).
export async function preparePixels(input, { crops = 1 } = {}) {
  const base = await sharp(input, { failOn: "none", limitInputPixels: 120_000_000 })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: 768, height: 768, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = base.info;
  const raw = { raw: { width: w, height: h, channels } };
  const side = Math.min(w, h);
  const edges = crops > 1 && Math.max(w, h) / side >= 1.2 ? [0, Math.max(w, h) - side] : [];
  const square = (off) =>
    sharp(base.data, raw)
      .extract(w >= h ? { left: off, top: 0, width: side, height: side } : { left: 0, top: off, width: side, height: side })
      .resize(CLIP_SIZE, CLIP_SIZE, { kernel: "cubic" })
      .raw()
      .toBuffer();
  const [a, b, ...more] = await Promise.all([
    sharp(base.data, raw).resize(NSFW_SIZE, NSFW_SIZE, { fit: "fill", kernel: "cubic" }).raw().toBuffer(),
    sharp(base.data, raw).resize(CLIP_SIZE, CLIP_SIZE, { fit: "cover", position: "centre", kernel: "cubic" }).raw().toBuffer(),
    ...edges.map(square),
  ]);
  return { nsfwPx: a, clipPx: b, clipEdges: more, channels };
}

// Символика, оружие, кровь, наркотики — максимум по всем квадратам. Обнажённость — по центру: всё фото целиком
// и так видит классификатор, а кусок фото в купальнике у края CLIP путает с обнажённой грудью (проверено на наборе).
const EDGE_CATS = ["nazi", "weapon", "blood", "drugs"];

async function run(input, crops) {
  const { nsfw, clip, text } = await loadEngine();
  const { nsfwPx, clipPx, clipEdges, channels } = await preparePixels(input, { crops });
  const o1 = await nsfw.run({ [nsfw.inputNames[0]]: new ort.Tensor("float32", nsfwInput(nsfwPx, channels), [1, 3, NSFW_SIZE, NSFW_SIZE]) });
  const embed = async (px) => {
    const o = await clip.run({ [clip.inputNames[0]]: new ort.Tensor("float32", clipInput(px, channels), [1, 3, CLIP_SIZE, CLIP_SIZE]) });
    return clipCategories(o[clip.outputNames[0]].data, text);
  };
  const cats = await embed(clipPx);
  for (const px of clipEdges) {
    const c = await embed(px);
    for (const k of EDGE_CATS) cats[k] = Math.max(cats[k], c[k]);
  }
  return moderationScores(nsfwProb(o1[nsfw.outputNames[0]].data), cats);
}

// Оценки для файла фото (Buffer/Uint8Array) → { v, nsfw, breast, nude, sex, nazi, weapon, blood, drugs, art, plain }.
// crops: 3 (по умолчанию на сервере) — центр и два края у вытянутого кадра; 1 — только центр, как на устройстве.
export function scoreImage(input, { crops = 3 } = {}) {
  const next = chain.then(() => run(input, crops));
  chain = next.catch(() => null);
  return next;
}
