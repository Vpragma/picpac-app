// Воркер ластика для превью (D1): MI-GAN отдельно от выделения касанием — «Отмена» выделения не останавливает
// ластик, а «Отмена» ластика не трогает выделение. Первая загрузка (wasm 14,8 МБ + модель 28 МБ) — с процентом.
import { eraseOnCanvas, loadEraser } from "./erase.js";

const send = (msg, transfer) => self.postMessage(msg, transfer || []);

async function erase({ id, rgba, w, h, ops }) {
  await loadEraser((p) => send({ id, type: "progress", stage: "load", p }));
  send({ id, type: "progress", stage: "erase", p: 0 });
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
    if (msg.type === "ping") return send({ id: msg.id, ok: true }); // «Скачать ИИ заранее»: код воркера уже загружен
    if (msg.type === "erase") await erase(msg);
    else throw new Error("unknown");
  } catch (err) {
    console.error("Воркер ластика:", err);
    send({ id: msg.id, ok: false, error: String(err?.message || err) });
  }
};
