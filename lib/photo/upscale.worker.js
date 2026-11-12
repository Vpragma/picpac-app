// Воркер «Резкость для печати» (D1 / S03c): UpscalerJS esrgan-slim ×2 (MIT), модель — public/models/upscaler/x2.
// Только с WebGL: на процессоре сеть считает минуты (research-s03, раздел 4), тогда честно отказываем.
// Вход — оригинал фото (≤ 1500 точек по длинной стороне), выход — JPEG ×2 по сторонам.
import * as tf from "@tensorflow/tfjs";
import Upscaler from "upscaler";
import x2 from "@upscalerjs/esrgan-slim/2x";

let upscaler = null;

async function ready() {
  if (upscaler) return upscaler;
  await tf.setBackend("webgl").catch(() => false);
  await tf.ready();
  if (tf.getBackend() !== "webgl") throw new Error("no_webgl");
  upscaler = new Upscaler({ model: { ...x2, path: "/models/upscaler/x2/model.json" } });
  await upscaler.ready;
  return upscaler;
}

self.onmessage = async (e) => {
  const { id, type, blob } = e.data || {};
  try {
    if (type === "check") {
      await ready();
      return self.postMessage({ id, ok: true });
    }
    const up = await ready();
    const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close?.();
    const input = tf.browser.fromPixels(c);
    const out = await up.upscale(input, {
      output: "tensor",
      patchSize: 64,
      padding: 2,
      progress: (p) => self.postMessage({ id, type: "progress", p }),
    });
    input.dispose();
    const [h, w] = out.shape;
    const ints = tf.tidy(() => out.clipByValue(0, 255).toInt());
    out.dispose();
    const px = await tf.browser.toPixels(ints);
    ints.dispose();
    const oc = new OffscreenCanvas(w, h);
    oc.getContext("2d").putImageData(new ImageData(px, w, h), 0, 0);
    const res = await oc.convertToBlob({ type: "image/jpeg", quality: 0.95 });
    self.postMessage({ id, ok: true, blob: res, width: w, height: h });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
