// Ластик MI-GAN (D1 / S03c): «Убрать» выделенное. Работает в воркерах (OffscreenCanvas): в воркере ИИ —
// для превью, в воркере печатной версии — в полном разрешении. Модель — public/models/migan (MIT, 28 МБ),
// onnxruntime-web — из public/ort (свой сайт, без CDN: работает со строгой CSP и без сети после первого раза).
//
// Для каждой правки «Убрать»: вырезка вокруг маски (рамка + поля) → уменьшение до ≤ 1024 → MI-GAN (сам режет
// дыру до 512) → результат растягивается обратно и вклеивается ТОЛЬКО внутри расширенной маски с мягким краем.
// Остальной кадр не меняется и остаётся в полном разрешении.
import * as ort from "onnxruntime-web/webgpu";
import { blendUp, eraseCrop, eraseHole, toMiganInputs } from "./mask.js";

export const MIGAN_URL = "/models/migan/migan_pipeline_v2.onnx";

let configured = false;
export function setupOrt() {
  if (configured) return ort;
  ort.env.wasm.wasmPaths = { mjs: "/ort/ort-wasm-simd-threaded.mjs", wasm: "/ort/ort-wasm-simd-threaded.wasm" };
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  configured = true;
  return ort;
}

let sessionP = null;
async function session() {
  setupOrt();
  sessionP ??= (async () => {
    const res = await fetch(MIGAN_URL);
    if (!res.ok) throw new Error("Не загрузилась модель ластика (" + res.status + ")");
    const buf = new Uint8Array(await res.arrayBuffer());
    return ort.InferenceSession.create(buf, { executionProviders: ["wasm"] });
  })().catch((e) => {
    sessionP = null;
    throw e;
  });
  return sessionP;
}

export function preloadEraser() {
  return session();
}

// Убрать по всем правкам ops на холсте ctx (OffscreenCanvasRenderingContext2D) размером fullW×fullH
export async function eraseOnCanvas(ctx, fullW, fullH, ops, onStep = () => {}) {
  let i = 0;
  for (const op of ops) {
    onStep({ done: i++, total: ops.length });
    const crop = eraseCrop(op, fullW, fullH);
    if (!crop) continue;
    const { iw, ih } = crop;
    const { hole, alpha } = eraseHole(op, crop, fullW, fullH);
    const sc = new OffscreenCanvas(iw, ih);
    const sctx = sc.getContext("2d", { willReadFrequently: true });
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(ctx.canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, iw, ih);
    const small = sctx.getImageData(0, 0, iw, ih);
    const { chw, keep } = toMiganInputs(small.data, hole, iw, ih);
    const s = await session();
    const out = await s.run({ image: new ort.Tensor("uint8", chw, [1, 3, ih, iw]), mask: new ort.Tensor("uint8", keep, [1, 1, ih, iw]) });
    const res = out.result.data;
    const n = iw * ih;
    // Результат нейросети → RGBA вырезки
    const rgba = new ImageData(iw, ih);
    for (let k = 0; k < n; k++) {
      rgba.data[k * 4] = res[k];
      rgba.data[k * 4 + 1] = res[n + k];
      rgba.data[k * 4 + 2] = res[2 * n + k];
      rgba.data[k * 4 + 3] = 255;
    }
    // Растянуть до размера вырезки в кадре и вклеить по мягкой маске
    let up = rgba;
    if (iw !== crop.w || ih !== crop.h) {
      sctx.putImageData(rgba, 0, 0);
      const bc = new OffscreenCanvas(crop.w, crop.h);
      const bctx = bc.getContext("2d", { willReadFrequently: true });
      bctx.imageSmoothingQuality = "high";
      bctx.drawImage(sc, 0, 0, crop.w, crop.h);
      up = bctx.getImageData(0, 0, crop.w, crop.h);
    }
    const orig = ctx.getImageData(crop.x, crop.y, crop.w, crop.h);
    blendUp(orig.data, up.data, alpha, iw, ih, crop.w, crop.h);
    ctx.putImageData(orig, crop.x, crop.y);
  }
  onStep({ done: ops.length, total: ops.length });
}
