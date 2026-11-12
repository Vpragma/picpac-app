// Воркер выделения касанием (D1 / S03c): SlimSAM на устройстве, без сети. Создаётся по нажатию
// «Выделить касанием» (lib/photo/ai.js); «Отмена» — terminate() воркера. Ластик — в своём воркере (erase.worker.js).
//
// SlimSAM: кодировщик `slimsam-77-uniform-boxes` (int8, Apache-2.0) из public/models — тяжёлая часть, один раз
// на фото (10–15 с на компьютере); результат держим, пока не сменилось фото (повторное «Выделить» — сразу).
// Декодер — на каждое касание (≈ 0,3 с). Точки: 1 — «это предмет», 0 — «это не он»; декодеру boxes нужна
// «пустая» точка (0, 0) с меткой −1, если нет рамки. Справка и подводные камни — docs/night/research-s03.md, 1–3.
//
// Загрузка: файлы модели и wasm скачиваем сами с процентом по байтам (размеры — lib/photo/modelFiles.js; Vercel
// сжимает .onnx и .wasm и не даёт Content-Length), отдаём transformers.js через env.fetch, а ORT — через wasmBinary.
import { AutoProcessor, env, RawImage, SamModel, Tensor } from "@huggingface/transformers";
import { fetchAll } from "./fetchBytes.js";
import { ORT_WASM, SAM_FILES, SAM_MODEL, YOLOX_FILE } from "./modelFiles.js";
import { needsWasm, ort as ortRt, setupOrt, setWasmBinary } from "./ort.js";
import { YOLOX_SIZE, yoloxDecode, yoloxInput } from "./yolox.js";

env.allowLocalModels = true;
env.allowRemoteModels = false; // никакого huggingface.co — только свой сайт
env.localModelPath = "/models/";
env.useWasmCache = false; // иначе wasm грузится как blob: — строгая CSP это запрещает
env.useBrowserCache = false; // модели кэширует наш сервис-воркер (/models/ — сначала кэш)
const ort = setupOrt();
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = ort.env.wasm.wasmPaths;
  env.backends.onnx.wasm.numThreads = 1;
}

// Уже скачанные файлы отдаём transformers.js из памяти (без второй загрузки)
const preloaded = new Map();
const nativeFetch = env.fetch || fetch.bind(self);
env.fetch = (input, init) => {
  const url = new URL(String(input), self.location.origin).pathname;
  const bytes = preloaded.get(url);
  if (bytes) return Promise.resolve(new Response(bytes, { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length) } }));
  return nativeFetch(input, init);
};

let model = null;
let processor = null;
let inputs = null;
let emb = null;
let embedKey = null;

const send = (msg, transfer) => self.postMessage(msg, transfer || []);

async function loadSam(id) {
  if (model && processor) return;
  const files = [...(needsWasm() ? [ORT_WASM] : []), ...SAM_FILES];
  const bytes = await fetchAll(files, (p) => send({ id, type: "progress", stage: "load", p }));
  if (bytes.has(ORT_WASM.url)) setWasmBinary(bytes.get(ORT_WASM.url));
  for (const f of SAM_FILES) preloaded.set(f.url, bytes.get(f.url));
  send({ id, type: "progress", stage: "start", p: 1 });
  model ??= await SamModel.from_pretrained(SAM_MODEL, { dtype: "q8", device: "wasm" });
  processor ??= await AutoProcessor.from_pretrained(SAM_MODEL);
  preloaded.clear(); // модель уже в памяти ORT — копии файлов не нужны
}

async function embed({ id, key, rgba, w, h }) {
  if (embedKey === key && emb) return send({ id, ok: true, w, h, cached: true });
  await loadSam(id);
  send({ id, type: "progress", stage: "embed", p: 0 });
  const image = new RawImage(new Uint8ClampedArray(rgba), w, h, 4).rgb();
  inputs = await processor(image);
  if (emb) for (const t of Object.values(emb)) t?.dispose?.();
  emb = await model.get_image_embeddings(inputs);
  embedKey = key;
  send({ id, ok: true, w, h });
}

// N3: поиск предметов (YOLOX-Nano) в этом же воркере — один wasm onnxruntime на выделение и поиск.
// Кадр приходит уже уменьшенным (≤ 416 по длинной стороне). Ответ — рамки в долях кадра.
let yolox = null;
async function detect({ id, rgba, w, h }) {
  if (!yolox) {
    const files = [...(needsWasm() ? [ORT_WASM] : []), YOLOX_FILE];
    const bytes = await fetchAll(files, (p) => send({ id, type: "progress", stage: "load", p }));
    if (bytes.has(ORT_WASM.url)) setWasmBinary(bytes.get(ORT_WASM.url));
    yolox = await ortRt.InferenceSession.create(bytes.get(YOLOX_FILE.url), { executionProviders: ["wasm"] });
  }
  const inp = yoloxInput(new Uint8Array(rgba), w, h);
  const out = await yolox.run({ [yolox.inputNames[0]]: new ortRt.Tensor("float32", inp.data, [1, 3, YOLOX_SIZE, YOLOX_SIZE]) });
  const t = out[yolox.outputNames[0]];
  const dets = yoloxDecode(t.data, inp);
  t.dispose?.();
  send({ id, ok: true, dets });
}

// N3: выделение по рамке найденного предмета: углы рамки — точки с метками 2 и 3 (декодер «boxes»), плюс центр —
// «это предмет». box — в долях кадра; ответ — маска, как у касания
async function segmentBox({ id, key, box }) {
  if (!emb || embedKey !== key) throw new Error("not_ready");
  const [H0, W0] = inputs.original_sizes[0];
  const pts = [
    [box.x0 * W0, box.y0 * H0],
    [box.x1 * W0, box.y1 * H0],
  ];
  const lab = [2, 3];
  const input_points = processor.reshape_input_points([pts], inputs.original_sizes, inputs.reshaped_input_sizes);
  const input_labels = new Tensor("int64", BigInt64Array.from(lab.map(BigInt)), [1, 1, lab.length]);
  const out = await model({ ...emb, input_points, input_labels });
  const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const scores = Array.from(out.iou_scores.data);
  const [, , H, W] = masks[0].dims;
  const best = scores.indexOf(Math.max(...scores));
  const mask = new Uint8Array(W * H);
  const d = masks[0].data;
  for (let i = 0; i < W * H; i++) mask[i] = d[best * H * W + i] ? 1 : 0;
  for (const t of [out.pred_masks, out.iou_scores, input_points, input_labels]) t?.dispose?.();
  send({ id, ok: true, w: W, h: H, score: scores[best], mask }, [mask.buffer]);
}

async function segment({ id, key, points }) {
  if (!emb || embedKey !== key) throw new Error("not_ready");
  const pts = points.map((p) => [p.x, p.y]);
  const lab = points.map((p) => (p.add ? 1 : 0));
  pts.push([0, 0]);
  lab.push(-1);
  const input_points = processor.reshape_input_points([pts], inputs.original_sizes, inputs.reshaped_input_sizes);
  const input_labels = new Tensor("int64", BigInt64Array.from(lab.map(BigInt)), [1, 1, lab.length]);
  const out = await model({ ...emb, input_points, input_labels });
  const masks = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  const scores = Array.from(out.iou_scores.data);
  const [, , H, W] = masks[0].dims;
  // Из трёх масок — лучшая по оценке; при одной точке SAM часто даёт «часть предмета» лучшей —
  // берём самую крупную из близких по оценке (касание обычно значит «весь предмет»)
  let best = scores.indexOf(Math.max(...scores));
  const area = (k) => {
    let n = 0;
    const d = masks[0].data;
    for (let i = k * H * W; i < (k + 1) * H * W; i++) if (d[i]) n++;
    return n;
  };
  if (points.length === 1) {
    let bestArea = area(best);
    for (let k = 0; k < scores.length; k++) {
      if (k === best || scores[k] < scores[best] - 0.05) continue;
      const a = area(k);
      if (a > bestArea && a < W * H * 0.9) {
        best = k;
        bestArea = a;
      }
    }
  }
  const mask = new Uint8Array(W * H);
  const d = masks[0].data;
  for (let i = 0; i < W * H; i++) mask[i] = d[best * H * W + i] ? 1 : 0;
  for (const t of [out.pred_masks, out.iou_scores, input_points, input_labels]) t?.dispose?.();
  send({ id, ok: true, w: W, h: H, score: scores[best], mask }, [mask.buffer]);
}

// Сообщения выполняются по очереди (N3): поиск предмета и изучение фото не качают wasm дважды и не мешают друг другу
let queue = Promise.resolve();
self.onmessage = (e) => {
  queue = queue.then(() => handle(e));
};

async function handle(e) {
  const msg = e.data || {};
  try {
    if (msg.type === "ping") return send({ id: msg.id, ok: true }); // «Скачать ИИ заранее»: код воркера уже загружен
    if (msg.type === "embed") await embed(msg);
    else if (msg.type === "segment") await segment(msg);
    else if (msg.type === "detect") await detect(msg);
    else if (msg.type === "box") await segmentBox(msg);
    else throw new Error("unknown");
  } catch (err) {
    console.error("ИИ-воркер:", err);
    send({ id: msg.id, ok: false, error: String(err?.message || err), stack: String(err?.stack || "").slice(0, 1500) });
  }
}
