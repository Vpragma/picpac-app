"use client";
// Первичная проверка фото на устройстве (W-15 → N4): оценки моделей (lib/photo/nsfw.worker.js) уходят на сервер
// вместе с фото; флаг «проверит модератор» ставит сервер (lib/moderation.js), а при оформлении заказа сервер
// проверяет файл сам (lib/server/moderationCheck.js) — подделка оценок на устройстве ничего не даёт.
// Тесты подменяют результат: window.__PICPAC_TEST__ = { nsfw: "clean" | "flag" } — модели не грузятся.
// Неудача (нет памяти, таймаут) → null: фото уходит без оценок, проверку делает сервер.
import "../workerShim"; // до создания воркеров: обход ошибки старых Chrome с адресами воркеров Turbopack

const FIRST_TIMEOUT_MS = 180_000; // первая проверка качает модели (≈ 125 МБ без сжатия, дальше — из кэша)
const TIMEOUT_MS = 30_000;
const FAKE = {
  clean: { v: 2, nsfw: 0.05, breast: 0.01, nude: 0.01, sex: 0, nazi: 0, weapon: 0, blood: 0, drugs: 0, art: 0 },
  flag: { v: 2, nsfw: 0.93, breast: 0.72, nude: 0.08, sex: 0.02, nazi: 0, weapon: 0, blood: 0, drugs: 0, art: 0 },
};

let worker = null;
let warm = false;
let seq = 0;
const waiting = new Map();
let idleTimer = null;
let chain = Promise.resolve(); // по одному фото за раз: модели и память телефона

function getWorker() {
  if (worker) return worker;
  warm = false;
  worker = new Worker(new URL("./nsfw.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data || {};
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.ok) {
      warm = true;
      w.resolve(m);
    } else w.reject(new Error(m.error || "moderation"));
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

// Режим экономии трафика — без CLIP (89 МБ): только классификатор обнажённости
const lite = () => typeof navigator !== "undefined" && navigator.connection?.saveData === true;

function run(blob) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const w = getWorker();
    const t = setTimeout(
      () => {
        waiting.delete(id);
        reject(new Error("timeout"));
      },
      warm ? TIMEOUT_MS : FIRST_TIMEOUT_MS,
    );
    waiting.set(id, {
      resolve: (m) => (clearTimeout(t), resolve(m)),
      reject: (e) => (clearTimeout(t), reject(e)),
    });
    w.postMessage({ id, blob, lite: lite() });
  });
}

// Оценки для фото: { v: 2, nsfw, breast, nude, sex, nazi, weapon, blood, drugs, art } или null (не получилось)
export function classifyPhoto(blob) {
  const test = typeof window !== "undefined" ? window.__PICPAC_TEST__?.nsfw : null;
  if (test && FAKE[test]) return Promise.resolve({ ...FAKE[test] });
  if (typeof window === "undefined" || typeof Worker !== "function" || !blob) return Promise.resolve(null);
  const next = chain.then(async () => {
    try {
      const m = await run(blob);
      return m.scores;
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
