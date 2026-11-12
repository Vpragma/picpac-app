// Воркер первичной цензуры (W-15): nsfwjs (MobileNetV2 224, модель в /models/nsfw/) на устройстве.
// Сообщение { id, blob } → { id, ok, preds: { porn, hentai, sexy, neutral, drawing }, backend }.
// Фото уменьшается до 224×224 (OffscreenCanvas), модель грузится один раз; без WebGL — на CPU (медленнее, но работает).
import * as tf from "@tensorflow/tfjs";
import { load } from "nsfwjs/core"; // не "nsfwjs": иначе в сборку попадут встроенные модели

let model = null;

async function ready() {
  if (model) return model;
  await tf.setBackend("webgl").catch(() => false);
  await tf.ready();
  if (tf.getBackend() !== "webgl") {
    await tf.setBackend("cpu");
    await tf.ready();
  }
  model = await load("/models/nsfw/model.json", { size: 224 });
  return model;
}

async function pixels(blob) {
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(224, 224);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0, 224, 224);
  bmp.close?.();
  return g.getImageData(0, 0, 224, 224);
}

self.onmessage = async (e) => {
  const { id, blob } = e.data || {};
  try {
    const m = await ready();
    const data = await pixels(blob);
    const img = tf.browser.fromPixels(data);
    const list = await m.classify(img, 5);
    img.dispose();
    const preds = { porn: 0, hentai: 0, sexy: 0, neutral: 0, drawing: 0 };
    for (const p of list) preds[String(p.className).toLowerCase()] = Math.round(p.probability * 10000) / 10000;
    self.postMessage({ id, ok: true, preds, backend: tf.getBackend() });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
