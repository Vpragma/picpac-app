"use client";
// N7 (C1, C2): куски редактора, которые грузятся по требованию (перетаскивание фото, шаг «Правки», анализ фото и его
// воркер), — заранее, в свободное время после открытия редактора, пока есть сеть. Запросы идут через сервис-воркер
// («сначала кэш» для /_next/static, public/sw.js) и остаются на устройстве: без сети фото добавляются, шаги открываются.
// Первый визит (страницу ещё не обслуживает воркер) — отправляем воркеру список загруженных файлов сборки.
// На первый JS страницы не влияет: это import() после загрузки, perf:budget считает только <script> из HTML.
const LOADERS = [
  () => import("../components/editor/SortablePhotos"),
  () => import("../components/editor/PhotoEditor"),
  () => import("./photo/analysis").then((m) => m.warmAnalysisWorker()),
];

let state = "idle"; // idle | waiting | done

function loadedAssets() {
  const prefix = location.origin + "/_next/static/";
  const urls = new Set();
  for (const el of document.querySelectorAll('script[src], link[rel="stylesheet"][href]')) {
    const u = el.src || el.href;
    if (u && u.startsWith(prefix)) urls.add(u);
  }
  for (const e of performance.getEntriesByType("resource")) if (e.name.startsWith(prefix)) urls.add(e.name);
  return [...urls];
}

async function sendToWorker() {
  if (!("serviceWorker" in navigator)) return;
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 10000))]);
  reg?.active?.postMessage({ type: "CACHE_URLS", urls: loadedAssets() });
}

async function run() {
  if (navigator.onLine === false) {
    state = "idle";
    return;
  }
  const res = await Promise.allSettled(LOADERS.map((load) => load()));
  state = res.some((r) => r.status === "rejected") ? "idle" : "done";
  await sendToWorker().catch(() => {});
}

// Один раз за сеанс; без сети — повторим, когда она появится
export function warmEditorChunks() {
  if (typeof window === "undefined" || state !== "idle") return;
  if (navigator.onLine === false) {
    window.addEventListener("online", warmEditorChunks, { once: true });
    return;
  }
  state = "waiting";
  const idle = (f) => (window.requestIdleCallback ? window.requestIdleCallback(f, { timeout: 3000 }) : setTimeout(f, 300));
  const start = () => setTimeout(() => idle(() => run().catch(() => (state = "idle"))), 1500);
  if (document.readyState === "complete") start();
  else window.addEventListener("load", start, { once: true });
}
