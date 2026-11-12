"use client";
// Клиенты воркеров ИИ (D1 / S03c): выделение касанием (lib/photo/ai.worker.js) и ластик
// (lib/photo/erase.worker.js) — два отдельных воркера: «Отмена» одного не останавливает другой.
// Воркеры создаются только по нажатию; «Отмена» — terminate(): единственный надёжный способ прервать тяжёлый
// расчёт и вернуть память.
import "../workerShim"; // до создания воркеров: обход ошибки старых Chrome с адресами воркеров Turbopack

function makeClient(create, name) {
  let worker = null;
  let seq = 0;
  const waiting = new Map();
  const failAll = (reason) => {
    for (const w of waiting.values()) w.reject(new Error(reason));
    waiting.clear();
  };
  const get = () => {
    if (worker) return worker;
    worker = create();
    worker.onmessage = (e) => {
      const m = e.data || {};
      const w = waiting.get(m.id);
      if (!w) return;
      if (m.type === "progress") return w.onProgress?.(m);
      waiting.delete(m.id);
      if (m.ok) w.resolve(m);
      else w.reject(Object.assign(new Error(m.error || "ai_error"), { workerStack: m.stack }));
    };
    worker.onerror = (e) => {
      console.error(name + ":", e.message);
      failAll("worker");
      worker?.terminate();
      worker = null;
    };
    return worker;
  };
  return {
    call(msg, transfer, onProgress) {
      return new Promise((resolve, reject) => {
        const id = ++seq;
        waiting.set(id, { resolve, reject, onProgress });
        get().postMessage({ ...msg, id }, transfer || []);
      });
    },
    stop() {
      if (!worker) return false;
      // Сначала отцепить обработчики: прерванная загрузка кода воркера не должна давать ложную ошибку в консоль
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      worker = null;
      failAll("cancelled");
      return true;
    },
    busy: () => waiting.size > 0,
  };
}

const sam = makeClient(() => new Worker(new URL("./ai.worker.js", import.meta.url), { type: "module" }), "Воркер выделения");
const eraser = makeClient(() => new Worker(new URL("./erase.worker.js", import.meta.url), { type: "module" }), "Воркер ластика");

// Последний результат кодировщика в воркере выделения: то же фото после «Готово» не изучаем заново
let lastEmbed = null; // { key, w, h }
export const embeddedFor = (key) => (lastEmbed && lastEmbed.key === key ? lastEmbed : null);

// Остановить выделение и освободить память (кнопка «Отмена», смена фото, уход из редактора)
export function stopAi() {
  lastEmbed = null;
  sam.stop();
}

// Остановить ластик (кнопка «Отмена» под фото, уход из редактора)
export const stopEraser = () => eraser.stop();
export const eraserBusy = () => eraser.busy();

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

// Почему выделения нет — коротко, для ответов на команды
export function aiWhy(sup) {
  if (sup?.reason === "memory") return "для него на этом телефоне мало памяти (нужно от 4 ГБ)";
  return "этот браузер его не умеет — обновите браузер";
}

// Тяжёлая часть SlimSAM — один раз на фото. img — ImageData (≤ 1024 по длинной стороне)
export async function embedImage(key, img, onProgress) {
  const rgba = img.data.slice().buffer;
  const r = await sam.call({ type: "embed", key, rgba, w: img.width, h: img.height }, [rgba], onProgress);
  lastEmbed = { key, w: r.w, h: r.h };
  return r;
}

// Лёгкая часть — на каждое касание. points: [{ x, y, add }] в точках картинки из embedImage
export function segmentPoints(key, points) {
  return sam.call({ type: "segment", key, points });
}

// N3: найти предметы на кадре (YOLOX-Nano в воркере выделения). img — ImageData ≤ 416 по длинной стороне.
// Ответ — [{ cls, name, score, x0, y0, x1, y1 }] в долях кадра. onProgress — первая загрузка модели (3,7 МБ)
export async function detectObjects(img, onProgress) {
  const rgba = img.data.slice().buffer;
  const r = await sam.call({ type: "detect", rgba, w: img.width, h: img.height }, [rgba], onProgress);
  return r.dets || [];
}

// N3: выделение по рамке найденного предмета (после embedImage того же кадра). box — в долях кадра
export function segmentBox(key, box) {
  return sam.call({ type: "box", key, box });
}

// Ластик для превью: ImageData кадра + правки «Убрать» (с масками внутри) → новый ImageData
export async function eraseImage(img, ops, onProgress) {
  const rgba = img.data.slice().buffer;
  const r = await eraser.call({ type: "erase", rgba, w: img.width, h: img.height, ops }, [rgba], onProgress);
  return new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h);
}
