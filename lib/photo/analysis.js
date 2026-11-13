"use client";
// Анализ фото проекта в воркере (по одному, чтобы не занимать память телефона) и автоулучшение.
// Результат: photo.quality = { v, metrics, problems, score }; для явно плохих фото (если выключатель включён)
// — photo.edits.auto. Оригинал не меняется. Модуль подгружается только редактором (import()).
import "../workerShim"; // до создания воркеров: обход ошибки старых Chrome с адресами воркеров Turbopack
import { getDraftState, getPhotoBlob, updateProject } from "../draft";
import { ANALYSIS_VERSION, autoParams, summarize } from "./analyze";
import { normEdits } from "./adjust";
import { getAutoEnhance } from "./settings";
import { track } from "../analytics";

let worker = null;
const waiting = new Map();
const busy = new Set();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./analyze.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, metrics, error } = e.data || {};
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      if (error) w.reject(new Error(error));
      else w.resolve(metrics);
    };
    worker.onerror = (e) => {
      // N7: ошибка воркера обработана здесь — не «необработанная ошибка страницы». Обрыв сети при загрузке кода
      // воркера (importScripts / импорт модуля) — как офлайн: тихо, следующий вызов создаст воркер заново.
      e.preventDefault?.();
      if (!/importScripts|import|fetch|network|load/i.test(e.message || "")) console.error("Воркер анализа:", e.message);
      for (const w of waiting.values()) w.reject(new Error("worker"));
      waiting.clear();
      try {
        worker?.terminate();
      } catch {}
      worker = null;
    };
  }
  return worker;
}

function measure(id, blob) {
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, blob });
  });
}

let running = null;
// Проанализировать фото проекта, у которых ещё нет оценки. Повторный вызов во время работы — дождётся и продолжит.
export function analyzeMissing(projectId) {
  if (running) return running.then(() => analyzeMissing(projectId));
  running = (async () => {
    for (;;) {
      const p = getDraftState().projects[projectId];
      if (!p || p.status === "ordered") return;
      const ph = p.photos.find((x) => x.supported && x.quality?.v !== ANALYSIS_VERSION && !busy.has(x.id));
      if (!ph) return;
      busy.add(ph.id);
      let quality = { v: ANALYSIS_VERSION, failed: true, problems: [] };
      let auto = null;
      try {
        const blob = await getPhotoBlob(ph.id);
        if (blob) {
          const metrics = await measure(ph.id, blob);
          quality = summarize(metrics);
          auto = getAutoEnhance() ? autoParams(metrics) : null;
        }
      } catch (e) {
        console.error(e);
      }
      updateProject(projectId, (d) => ({
        ...d,
        photos: d.photos.map((x) => {
          if (x.id !== ph.id) return x;
          const ed = normEdits(x.edits);
          const withAuto = auto && !ed.auto && !ed.autoOff;
          return { ...x, quality, ...(withAuto ? { edits: { ...ed, auto } } : {}) };
        }),
      }));
      if (auto) track("ai_edit", { props: { kind: "auto", count: 1 } });
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
