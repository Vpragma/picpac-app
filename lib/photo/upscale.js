"use client";
// «Резкость для печати» (D1 / S03c): ×2 для фото, которым не хватает точек на своём месте.
// Результат хранится на устройстве (IndexedDB kv «up:<id фото>»), в правках — только { upscale: 2 }.
// Печатная версия берёт его (или считает заново на другом устройстве) — сервер принимает файл ровно ×2.
import { kvGet, kvSet } from "../draft";

export const UPSCALE_MAX_SIDE = 1500; // больше — результат не помещается в память телефона одним куском

let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./upscale.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data || {};
    const w = waiting.get(m.id);
    if (!w) return;
    if (m.type === "progress") return w.onProgress?.(m.p);
    waiting.delete(m.id);
    if (m.ok) w.resolve(m);
    else w.reject(new Error(m.error || "upscale"));
  };
  worker.onerror = (e) => {
    console.error("Воркер резкости:", e.message);
    for (const w of waiting.values()) w.reject(new Error("worker"));
    waiting.clear();
    worker = null;
  };
  return worker;
}

function call(msg, onProgress) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ ...msg, id });
  });
}

export function stopUpscale() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const w of waiting.values()) w.reject(new Error("cancelled"));
  waiting.clear();
}

// Есть ли WebGL в воркере (без него — минуты на фото, кнопку не показываем)
let checked = null;
export function canUpscale() {
  if (typeof OffscreenCanvas === "undefined" || typeof Worker === "undefined") return Promise.resolve(false);
  checked ??= call({ type: "check" })
    .then(() => true)
    .catch(() => false);
  return checked;
}

export const upscaleKey = (photoId) => "up:" + photoId;

export async function upscaleBlob(blob, onProgress) {
  const r = await call({ type: "upscale", blob }, onProgress);
  return r;
}

// Готовый ×2 для фото: с устройства или посчитать заново (и сохранить)
export async function getUpscaled(photoId, blob, onProgress) {
  const saved = await kvGet(upscaleKey(photoId)).catch(() => null);
  if (saved instanceof Blob) return saved;
  const r = await upscaleBlob(blob, onProgress);
  await kvSet(upscaleKey(photoId), r.blob).catch(() => {});
  return r.blob;
}
