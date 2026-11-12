"use client";
// Печатные версии изменённых фото (S03e). Вызывается при оформлении заказа (app/cart/page.js, import() —
// в бандл корзины не попадает). Для каждого фото с правками: оригинал полного размера → воркер (OffscreenCanvas,
// lib/photo/print.worker.js) → JPEG того же размера → загрузка «печатной версии» рядом с оригиналом →
// PUT …/print { path, edits }: сервер проверяет файл и записывает правки и путь в фото проекта, а снимок заказа
// (order_items.snapshot.photos[].edits.print) получает их при оформлении. Оригинал не меняется.
// Правки сняли — PUT { path: null }: печатаем оригинал. Уже собранная версия с теми же правками не пересобирается.
import { callApi } from "../api";
import { getDraftState, getPhotoBlob, updateProjectMeta } from "../draft";
import { compactEdits } from "./edits";

const sig = (e) => JSON.stringify(e || null);

let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./print.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const { id, error, ...rest } = e.data || {};
      const w = waiting.get(id);
      if (!w) return;
      waiting.delete(id);
      if (error) w.reject(new Error(error));
      else w.resolve(rest);
    };
    worker.onerror = (e) => {
      console.error("Воркер печатной версии:", e.message);
      for (const w of waiting.values()) w.reject(new Error("worker"));
      waiting.clear();
      worker = null;
    };
  }
  return worker;
}

export function renderPrint(blob, edits) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, blob, edits });
  });
}

// Фото проектов корзины, которым нужна печатная версия (или её снятие)
export function printJobs(localProjectIds) {
  const st = getDraftState();
  const jobs = [];
  for (const pid of localProjectIds) {
    const p = st.projects[pid];
    if (!p?.serverId) continue;
    for (const ph of p.photos || []) {
      if (!ph.serverId) continue;
      const edits = compactEdits(ph.edits);
      const s = sig(edits);
      if ((ph.print ? ph.print.sig : sig(null)) === s) continue;
      jobs.push({ pid, sid: p.serverId, ph, edits, s });
    }
  }
  return jobs;
}

// onProgress({ done, total }) — для надписи на кнопке. Ошибка одного фото не останавливает заказ:
// правки записываются в фото без файла, печать применит их по параметрам.
export async function preparePrintVersions(localProjectIds, onProgress = () => {}) {
  const jobs = printJobs(localProjectIds);
  const failed = [];
  let done = 0;
  for (const j of jobs) {
    onProgress({ done, total: jobs.length });
    const api = `/api/v1/projects/${j.sid}/photos/${j.ph.serverId}/print`;
    let print = null;
    try {
      if (!j.edits) {
        const c = await callApi(api, { method: "PUT", body: { path: null } });
        if (!c.ok) throw new Error(c.error?.message || "print_clear");
      } else {
        const blob = await getPhotoBlob(j.ph.id);
        if (!blob) throw new Error("Нет файла фото на устройстве");
        const out = await renderPrint(blob, j.edits);
        const u = await callApi(api, { body: { bytes: out.blob.size } });
        if (!u.ok) throw new Error(u.error?.message || "print_url");
        const put = await fetch(u.upload.url, { method: "PUT", headers: u.upload.headers, body: out.blob });
        if (!put.ok) throw new Error("Хранилище не приняло печатную версию (" + put.status + ")");
        const c = await callApi(api, { method: "PUT", body: { path: u.upload.path, edits: j.edits } });
        if (!c.ok) throw new Error(c.error?.message || "print_save");
        print = c.print;
      }
      updateProjectMeta(j.pid, (x) => ({ ...x, photos: x.photos.map((y) => (y.id === j.ph.id ? { ...y, print: { sig: j.s, path: print?.path || null } } : y)) }));
    } catch (e) {
      console.warn("Печатная версия не собрана:", j.ph.name, e?.message);
      failed.push(j.ph.name);
      if (j.edits) await callApi(api, { method: "PUT", body: { path: null, edits: j.edits } }).catch(() => {});
    }
    done++;
  }
  onProgress({ done, total: jobs.length });
  return { total: jobs.length, failed };
}
