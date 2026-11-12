// Воркер ИИ редактора (D1 / S03c): выделение касанием (SlimSAM) и ластик (MI-GAN) — на устройстве, без сети.
// Создаётся только при нажатии «Выделить» или «Убрать» (lib/photo/ai.js), отмена — terminate() воркера.
//
// SlimSAM: кодировщик `slimsam-77-uniform-boxes` (int8, Apache-2.0) из public/models — тяжёлая часть, один раз
// на фото (10–15 с на компьютере); декодер — на каждое касание (≈ 0,3 с). Точки: 1 — «это предмет»,
// 0 — «это не он»; декодеру boxes нужна «пустая» точка (0, 0) с меткой −1, если нет рамки.
// Справка и подводные камни — docs/night/research-s03.md, разделы 1–3.
import { AutoProcessor, env, RawImage, SamModel, Tensor } from "@huggingface/transformers";
import { eraseOnCanvas, setupOrt } from "./erase.js";

const MODEL = "slimsam-77-uniform-boxes";

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

let model = null;
let processor = null;
let inputs = null;
let emb = null;
let embedKey = null;

const send = (msg, transfer) => self.postMessage(msg, transfer || []);

async function loadSam(id) {
  const progress = (p) => {
    if (p.status === "progress" && p.total) send({ id, type: "progress", stage: "load", p: p.loaded / p.total, file: p.file });
  };
  model ??= await SamModel.from_pretrained(MODEL, { dtype: "q8", device: "wasm", progress_callback: progress });
  processor ??= await AutoProcessor.from_pretrained(MODEL);
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

async function erase({ id, rgba, w, h, ops }) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  await eraseOnCanvas(ctx, w, h, ops, (s) => send({ id, type: "progress", stage: "erase", p: s.total ? s.done / s.total : 0 }));
  const out = ctx.getImageData(0, 0, w, h);
  send({ id, ok: true, w, h, rgba: out.data.buffer }, [out.data.buffer]);
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === "embed") await embed(msg);
    else if (msg.type === "segment") await segment(msg);
    else if (msg.type === "erase") await erase(msg);
    else throw new Error("unknown");
  } catch (err) {
    console.error("ИИ-воркер:", err);
    send({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};
