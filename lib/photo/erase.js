// Ластик MI-GAN (D1 / S03c): «Убрать» выделенное. Работает в воркерах (OffscreenCanvas): в своём воркере
// (lib/photo/erase.worker.js) — для превью, в воркере печатной версии — в полном разрешении. Модель — public/models/migan (MIT, 28 МБ),
// onnxruntime-web — из public/ort (свой сайт, без CDN: работает со строгой CSP и без сети после первого раза).
//
// Для каждой правки «Убрать»: вырезка вокруг маски (рамка + поля) → уменьшение до ≤ 1024 → MI-GAN (сам режет
// дыру до 512) → результат растягивается обратно и вклеивается ТОЛЬКО внутри расширенной маски с мягким краем.
// Остальной кадр не меняется и остаётся в полном разрешении.
import { fetchAll } from "./fetchBytes.js";
import { blendUp, eraseCrop, eraseHole, toMiganInputs } from "./mask.js";
import { MIGAN_FILE, ORT_WASM } from "./modelFiles.js";
import { needsWasm, ort, setupOrt, setWasmBinary } from "./ort.js";

let sessionP = null;

// Загрузить ластик: wasm (если в этом воркере ещё нет) и модель MI-GAN — с процентом onProgress(0…1)
export function loadEraser(onProgress = () => {}) {
  setupOrt();
  sessionP ??= (async () => {
    const files = [...(needsWasm() ? [ORT_WASM] : []), MIGAN_FILE];
    const bytes = await fetchAll(files, onProgress);
    if (bytes.has(ORT_WASM.url)) setWasmBinary(bytes.get(ORT_WASM.url));
    return ort.InferenceSession.create(bytes.get(MIGAN_FILE.url), { executionProviders: ["wasm"] });
  })().catch((e) => {
    sessionP = null;
    throw e;
  });
  return sessionP;
}

// Убрать по всем правкам ops (с масками внутри — hydrateOps) на холсте ctx размером fullW×fullH
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
    const s = await loadEraser();
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
