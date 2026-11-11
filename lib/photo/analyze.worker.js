// Воркер анализа фото: уменьшает снимок до 512 точек (OffscreenCanvas) и считает метрики.
// Загружается только в редакторе (new Worker из lib/photo/analysis.js), интерфейс не замирает.
import { analyzePixels, ANALYSIS_SIDE } from "./analyze";

async function decode(blob) {
  const probe = await createImageBitmap(blob);
  const k = Math.min(1, ANALYSIS_SIDE / Math.max(probe.width, probe.height));
  const w = Math.max(1, Math.round(probe.width * k));
  const h = Math.max(1, Math.round(probe.height * k));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(probe, 0, 0, w, h);
  probe.close?.();
  return { data: ctx.getImageData(0, 0, w, h).data, w, h };
}

self.onmessage = async (e) => {
  const { id, blob } = e.data || {};
  try {
    const { data, w, h } = await decode(blob);
    self.postMessage({ id, metrics: analyzePixels(data, w, h) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
