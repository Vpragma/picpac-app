"use client";
// Клиент воркера ИИ (D1 / S03c): выделение касанием и ластик. Воркер создаётся только по нажатию,
// «Отмена» и закрытие редактора — terminate(): единственный надёжный способ прервать тяжёлый расчёт и вернуть память.

let worker = null;
let seq = 0;
const waiting = new Map();

function failAll(reason) {
  for (const w of waiting.values()) w.reject(new Error(reason));
  waiting.clear();
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./ai.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data || {};
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === "progress") return w.onProgress?.(m);
    waiting.delete(m.id);
    if (m.ok) w.resolve(m);
    else w.reject(new Error(m.error || "ai_error"));
  };
  worker.onerror = (e) => {
    console.error("ИИ-воркер:", e.message);
    failAll("worker");
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function call(msg, transfer, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...msg, id }, transfer || []);
  });
}

// Остановить всё и освободить память (кнопка «Отмена», уход со страницы)
export function stopAi() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  failAll("cancelled");
}

export const isCancelled = (e) => e?.message === "cancelled";

// Можно ли на этом устройстве выделять касанием: WebAssembly SIMD, воркеры с OffscreenCanvas и память.
// Кодировщику SlimSAM нужно около 2 ГБ — на телефоне с памятью меньше 4 ГБ вкладку может закрыть система.
export function aiSupport() {
  if (typeof window === "undefined") return { ok: false, reason: "server" };
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined" || typeof WebAssembly === "undefined")
    return { ok: false, reason: "old", say: "Этот браузер не умеет выделять касанием. Обновите браузер — а пока работают команды и ползунки." };
  let simd = false;
  try {
    simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  } catch {
    simd = false;
  }
  if (!simd) return { ok: false, reason: "simd", say: "Этот браузер не умеет выделять касанием (нет WebAssembly SIMD). Обновите браузер — а пока работают команды и ползунки." };
  const mem = navigator.deviceMemory;
  if (mem && mem < 4) return { ok: false, reason: "memory", say: "На этом телефоне мало памяти для выделения касанием (нужно от 4 ГБ). Работают команды, ползунки и «убери солнце»." };
  return { ok: true };
}

// Тяжёлая часть SlimSAM — один раз на фото. img — ImageData (≤ 1024 по длинной стороне)
export function embedImage(key, img, onProgress) {
  const rgba = img.data.slice().buffer;
  return call({ type: "embed", key, rgba, w: img.width, h: img.height }, [rgba], onProgress);
}

// Лёгкая часть — на каждое касание. points: [{ x, y, add }] в точках картинки из embedImage
export function segmentPoints(key, points) {
  return call({ type: "segment", key, points });
}

// Ластик для превью: ImageData кадра + правки «Убрать» → новый ImageData
export async function eraseImage(img, ops, onProgress) {
  const rgba = img.data.slice().buffer;
  const r = await call({ type: "erase", rgba, w: img.width, h: img.height, ops }, [rgba], onProgress);
  return new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h);
}
