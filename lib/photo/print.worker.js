// Воркер печатной версии (S03e): оригинал полного размера + все правки → JPEG того же размера.
// OffscreenCanvas, полосами по 256 строк — интерфейс не замирает, память телефона не переполняется.
import { applyEdits } from "./adjust";
import { healCircle, opBox } from "./local";

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
    for (let y = 0; y < h; y += STRIPE) {
      const sh = Math.min(STRIPE, h - y);
      const img = ctx.getImageData(0, y, w, sh);
      applyEdits(img.data, img.data, edits);
      ctx.putImageData(img, 0, y);
    }
    // Местные правки (S03c): только область круга, в полном разрешении
    for (const op of edits?.ops || []) {
      if (op?.kind !== "heal") continue;
      const b = opBox(op, w, h, 3);
      if (b.w < 3 || b.h < 3) continue;
      const img = ctx.getImageData(b.x, b.y, b.w, b.h);
      healCircle(img.data, b.w, b.h, op, b.x, b.y, w, h);
      ctx.putImageData(img, b.x, b.y);
    }
    const out = await c.convertToBlob({ type: "image/jpeg", quality });
    self.postMessage({ id, blob: out, width: w, height: h });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
