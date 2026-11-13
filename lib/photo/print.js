"use client";
// Печатные версии изменённых фото (S03e). Вызывается при оформлении заказа (app/cart/page.js; модуль лёгкий,
// воркер с пиксельной математикой грузится только при сборке). Для каждого фото с правками: оригинал полного размера → воркер (OffscreenCanvas,
// lib/photo/print.worker.js) → JPEG того же размера → загрузка «печатной версии» рядом с оригиналом →
// PUT …/print { path, edits }: сервер проверяет файл и записывает правки и путь в фото проекта, а снимок заказа
// (order_items.snapshot.photos[].edits.print) получает их при оформлении. Оригинал не меняется.
// N7: печатная версия собирается со ВСЕМИ правками, включая местные (маски, ластик, «убери солнце»), а на сервер
// вместе с файлом уходят только общие параметры (serverEdits) — маски и координаты остаются на устройстве.
// Правки сняли — PUT { path: null }: печатаем оригинал. Уже собранная версия с теми же правками не пересобирается.
import "../workerShim"; // до создания воркеров: обход ошибки старых Chrome с адресами воркеров Turbopack
import { callApi } from "../api";
import { getDraftState, getPhotoBlob, updateProjectMeta } from "../draft";
import { PHOTO_EDITS_MAX, compactEdits, editsBytes, isEdited, serverEdits } from "./edits";
import { packEdits } from "./maskStore";

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
      if (rest.type === "progress") return;
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
      // Отменённое автоулучшение без других правок — это оригинал: печатная версия не нужна.
      // Маски выделения — в edits.masks по одной (старые черновики с маской в каждой правке сжимаются без потерь)
      const edits = isEdited(ph.edits) ? packEdits(compactEdits(ph.edits)) : null;
      const s = sig(edits);
      if ((ph.print ? ph.print.sig : sig(null)) === s) continue;
      jobs.push({ pid, sid: p.serverId, ph, edits, s });
    }
  }
  return jobs;
}

// Отказ, который повтор не исправит (правки фото не помещаются, сервер отказал по существу): честный текст
// и куда идти — без «Проверьте интернет» и без бесконечного «Повторить». projectId — открыть правки.
export class PrintFixError extends Error {
  constructor(message, { projectId = null, photos = [], code = "print_refused" } = {}) {
    super(message);
    this.final = true;
    this.projectId = projectId;
    this.photos = photos;
    this.code = code;
  }
}

const quoted = (list) => list.map((n) => `«${n}»`).join(", ");
// 4xx (кроме «слишком часто» и тайм-аута) — сервер отказал по существу, повтор не поможет
const refused = (r) => r && r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;

// onProgress({ done, total }) — для надписи на кнопке. Сбой сети при сборке одного фото не останавливает заказ:
// правки записываются в фото без файла, печать применит их по параметрам.
export async function preparePrintVersions(localProjectIds, onProgress = () => {}) {
  const jobs = printJobs(localProjectIds);
  // До сборки: правок по выделению не больше, чем допускает редактор (старые черновики могли накопить больше)
  const big = jobs.filter((j) => j.edits && editsBytes(j.edits) > PHOTO_EDITS_MAX);
  if (big.length) {
    const names = big.map((j) => j.ph.name);
    throw new PrintFixError(
      `На фото ${quoted(names)} слишком много правок по выделению — сохранить их для печати не получится. Откройте проект, шаг «Правки», и уберите часть правок кнопкой «Отменить».`,
      { projectId: big[0].pid, photos: names, code: "edits_too_large" },
    );
  }
  const failed = [];
  const lost = []; // ни файла, ни правок на сервере — заказ с такими фото не оформляем
  const denied = []; // сервер отказал по существу: { name, message, pid }
  let done = 0;
  for (const j of jobs) {
    onProgress({ done, total: jobs.length });
    const api = `/api/v1/projects/${j.sid}/photos/${j.ph.serverId}/print`;
    let print = null;
    try {
      if (!j.edits) {
        const c = await callApi(api, { method: "PUT", body: { path: null } });
        if (!c.ok) throw Object.assign(new Error(c.error?.message || "print_clear"), { res: c });
      } else {
        let blob = await getPhotoBlob(j.ph.id);
        if (!blob) throw new Error("Нет файла фото на устройстве");
        // «Резкость для печати» (D1): печатаем увеличенный ×2 файл (с этого устройства или посчитаем заново)
        if (j.edits.upscale === 2) {
          const { getUpscaled } = await import("./upscale");
          blob = await getUpscaled(j.ph.id, blob);
        }
        const out = await renderPrint(blob, j.edits);
        const u = await callApi(api, { body: { bytes: out.blob.size } });
        if (!u.ok) throw Object.assign(new Error(u.error?.message || "print_url"), { res: u });
        const put = await fetch(u.upload.url, { method: "PUT", headers: u.upload.headers, body: out.blob });
        if (!put.ok) throw new Error("Хранилище не приняло печатную версию (" + put.status + ")");
        const c = await callApi(api, { method: "PUT", body: { path: u.upload.path, edits: serverEdits(j.edits) || {} } });
        if (!c.ok) throw Object.assign(new Error(c.error?.message || "print_save"), { res: c });
        print = c.print;
      }
      updateProjectMeta(j.pid, (x) => ({ ...x, photos: x.photos.map((y) => (y.id === j.ph.id ? { ...y, print: { sig: j.s, path: print?.path || null } } : y)) }));
    } catch (e) {
      console.warn("Печатная версия не собрана:", j.ph.name, e?.message);
      if (refused(e?.res)) {
        denied.push({ name: j.ph.name, message: e.res.error?.message || "Сервер не принял печатную версию.", pid: j.pid });
      } else if (j.edits?.ops?.length) {
        // Местные правки живут только на устройстве: без собранного файла печать их не получит — заказ не оформляем,
        // просим повторить (параметрами их не передать — маски и координаты на сервер не уходят)
        lost.push(j.ph.name);
      } else {
        failed.push(j.ph.name);
        const general = serverEdits(j.edits);
        const saved = await callApi(api, { method: "PUT", body: { path: null, ...(general ? { edits: general } : {}) } }).catch(() => null);
        if (refused(saved)) denied.push({ name: j.ph.name, message: saved.error?.message || "Сервер не принял правки фото.", pid: j.pid });
        else if (!saved?.ok) lost.push(j.ph.name);
      }
    }
    done++;
  }
  onProgress({ done, total: jobs.length });
  if (denied.length) {
    throw new PrintFixError(denied.map((d) => `Фото «${d.name}»: ${d.message}`).join(" "), { projectId: denied[0].pid, photos: denied.map((d) => d.name) });
  }
  if (lost.length) {
    const err = new Error(navigator.onLine === false ? "offline" : "Не получилось подготовить фото к печати. Проверьте интернет и нажмите «Повторить».");
    err.photos = lost;
    throw err;
  }
  return { total: jobs.length, failed };
}
