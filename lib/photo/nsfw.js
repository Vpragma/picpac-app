"use client";
// Первичная цензура на устройстве (W-15): оценки nsfwjs для фото перед отправкой на сервер (lib/sync.js).
// Сервер ставит флаг по порогам (porn + hentai > 0,7 или sexy > 0,85) — такое фото проверит модератор.
// Тесты подменяют результат: window.__PICPAC_TEST__ = { nsfw: "clean" | "flag" } — модель не грузится.
// Неудача (нет памяти, таймаут) → null: фото уходит без оценок, заказ всё равно проходит обычные проверки.
import "../workerShim"; // до создания воркеров: обход ошибки старых Chrome с адресами воркеров Turbopack

const TIMEOUT_MS = 25_000;
const FAKE = {
  clean: { porn: 0.01, hentai: 0.01, sexy: 0.05, neutral: 0.9, drawing: 0.03 },
  flag: { porn: 0.88, hentai: 0.04, sexy: 0.05, neutral: 0.02, drawing: 0.01 },
};

let worker = null;
let seq = 0;
const waiting = new Map();
let idleTimer = null;
let chain = Promise.resolve(); // по одному фото за раз: модель и память телефона

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./nsfw.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data || {};
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) w.resolve(m);
    else w.reject(new Error(m.error || "nsfw"));
  };
  worker.onerror = (e) => {
    console.error("Воркер проверки фото:", e.message);
    for (const w of waiting.values()) w.reject(new Error("worker"));
    waiting.clear();
    worker = null;
  };
  return worker;
}

// Освобождаем память через минуту простоя
function scheduleIdle() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (waiting.size || !worker) return;
    worker.terminate();
    worker = null;
  }, 60_000);
}

function run(blob) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const t = setTimeout(() => {
      waiting.delete(id);
      reject(new Error("timeout"));
    }, TIMEOUT_MS);
    waiting.set(id, {
      resolve: (m) => (clearTimeout(t), resolve(m)),
      reject: (e) => (clearTimeout(t), reject(e)),
    });
    getWorker().postMessage({ id, blob });
  });
}

// Оценки для фото: { porn, hentai, sexy, neutral, drawing } или null (не получилось)
export function classifyPhoto(blob) {
  const test = typeof window !== "undefined" ? window.__PICPAC_TEST__?.nsfw : null;
  if (test && FAKE[test]) return Promise.resolve({ ...FAKE[test] });
  if (typeof window === "undefined" || typeof Worker !== "function" || !blob) return Promise.resolve(null);
  const next = chain.then(async () => {
    try {
      const m = await run(blob);
      return m.preds;
    } catch (e) {
      console.warn("Проверка фото на устройстве не удалась:", e?.message);
      return null;
    } finally {
      scheduleIdle();
    }
  });
  chain = next.catch(() => null);
  return next;
}
