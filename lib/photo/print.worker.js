// Воркер печатной версии (S03e): оригинал полного размера + все правки → JPEG того же размера
// (или ×2, если включена «Резкость для печати» — тогда на вход приходит уже увеличенный файл).
// OffscreenCanvas, полосами по 256 строк — интерфейс не замирает, память телефона не переполняется.
// Порядок как в превью редактора: ластик (D1, нейросеть MI-GAN — грузится, только если есть «Убрать»)
// → свет и цвет → местные правки по порядку («убери солнце», размыть фон, осветлить, затемнить).
import { applyEdits } from "./adjust";
import { healCircle, opBox } from "./local";
import { applyMaskOp, blurSize, downscaleRGBA, isMaskTone, prepareMaskOp, splitOps } from "./mask";

const STRIPE = 256;

self.onmessage = async (e) => {
  const { id, blob, edits, quality = 0.92 } = e.data || {};
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const w = bmp.width;
    const h = bmp.height;
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const { erase, rest } = splitOps(edits?.ops);
    if (erase.length) {
      const { eraseOnCanvas } = await import("./erase");
      await eraseOnCanvas(ctx, w, h, erase, (s) => self.postMessage({ id, type: "progress", stage: "erase", ...s }));
    }
    for (let y = 0; y < h; y += STRIPE) {
      const sh = Math.min(STRIPE, h - y);
      const img = ctx.getImageData(0, y, w, sh);
      applyEdits(img.data, img.data, edits);
      ctx.putImageData(img, 0, y);
    }
    for (const op of rest) {
      if (op?.kind === "heal") {
        // «Убери солнце» (S03c): только область круга, в полном разрешении
        const b = opBox(op, w, h, 3);
        if (b.w < 3 || b.h < 3) continue;
        const img = ctx.getImageData(b.x, b.y, b.w, b.h);
        healCircle(img.data, b.w, b.h, op, b.x, b.y, w, h);
        ctx.putImageData(img, b.x, b.y);
      } else if (isMaskTone(op)) {
        // Правка по маске (D1): маска растягивается на полный кадр с мягким краем; размытый фон —
        // из уменьшенной копии кадра (как в превью)
        let smallFrame = null;
        if (op.act === "blurBg") {
          const s = blurSize(w, h);
          const sc = new OffscreenCanvas(s.w, s.h);
          const sctx = sc.getContext("2d", { willReadFrequently: true });
          sctx.imageSmoothingQuality = "high";
          sctx.drawImage(c, 0, 0, s.w, s.h);
          smallFrame = { data: downscaleRGBA(sctx.getImageData(0, 0, s.w, s.h).data, s.w, s.h, s.w, s.h), w: s.w, h: s.h };
        }
        const prep = prepareMaskOp(op, { smallFrame });
        if (!prep) continue;
        for (let y = 0; y < h; y += STRIPE) {
          const sh = Math.min(STRIPE, h - y);
          const img = ctx.getImageData(0, y, w, sh);
          applyMaskOp(img.data, w, sh, prep, 0, y, w, h);
          ctx.putImageData(img, 0, y);
        }
      }
    }
    const out = await c.convertToBlob({ type: "image/jpeg", quality });
    self.postMessage({ id, blob: out, width: w, height: h });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
