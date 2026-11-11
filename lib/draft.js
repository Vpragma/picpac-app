"use client";
// Черновик книги в IndexedDB: продукт, настройки, фото и их порядок.
// Переживает перезагрузку страницы. Фото хранятся отдельно от настроек,
// чтобы перестановка не перезаписывала большие файлы.
import { useSyncExternalStore } from "react";

const DB_NAME = "picpac";
const SUPPORTED = ["image/jpeg", "image/png"];
const MAX_BYTES = 25 * 1024 * 1024; // как в каталоге и на сервере (бакет photos)

let dbPromise = null;
const OPEN_TIMEOUT_MS = 3000;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let done = false;
      const fail = (err) => {
        if (done) return;
        done = true;
        dbPromise = null; // следующая попытка откроет базу заново
        reject(err);
      };
      // Если база не ответила за 3 секунды — считаем, что она недоступна.
      const timer = setTimeout(() => fail(new Error("timeout")), OPEN_TIMEOUT_MS);
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        clearTimeout(timer);
        return fail(e);
      }
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos");
      };
      // База занята старой вкладкой с другой версией
      req.onblocked = () => {
        clearTimeout(timer);
        fail(new Error("blocked"));
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const d = req.result;
        // Другая вкладка обновляет базу — закрываем своё соединение, чтобы не мешать.
        d.onversionchange = () => {
          d.close();
          dbPromise = null;
        };
        if (done) return d.close();
        done = true;
        resolve(d);
      };
      req.onerror = () => {
        clearTimeout(timer);
        fail(req.error);
      };
    });
  }
  return dbPromise;
}

async function idb(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const get = (store, key) => idb(store, "readonly", (s) => s.get(key));
const put = (store, key, val) => idb(store, "readwrite", (s) => s.put(val, key));
const del = (store, key) => idb(store, "readwrite", (s) => s.delete(key));
const getAllProjects = () => idb("kv", "readonly", (s) => s.getAll(IDBKeyRange.bound("project:", "project:\uffff")));

// --- общее состояние для всех экранов ---
// projects — все проекты на устройстве { id: проект }, currentId — открытый в редакторе.
// draft — открытый проект (для экранов, которые работают с одним проектом).
// Статусы проекта как на сервере: draft «Черновик», in_cart «В корзине», ordered «Заказан».
let state = { ready: false, error: null, projects: {}, currentId: null, draft: null, thumbs: {}, uploads: [] };
const listeners = new Set();
function emit(next) {
  state = { ...state, ...next };
  state.draft = (state.currentId && state.projects[state.currentId]) || null;
  listeners.forEach((l) => l(state));
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

let loading = null;
async function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const list = (await getAllProjects()) || [];
      // Черновик старого формата (один на устройство) превращаем в проект
      const legacy = await get("kv", "draft");
      if (legacy) {
        const p = normalize({ ...legacy, id: newId() });
        await put("kv", "project:" + p.id, p);
        await del("kv", "draft");
        await put("kv", "currentId", p.id);
        list.push(p);
      }
      const projects = {};
      for (const p of list) projects[p.id] = normalize(p);
      let currentId = (await get("kv", "currentId")) || null;
      if (!projects[currentId]) currentId = null;
      const thumbs = {};
      for (const p of Object.values(projects)) {
        for (const ph of p.photos) {
          const rec = await get("photos", ph.id);
          if (rec?.thumb) thumbs[ph.id] = URL.createObjectURL(rec.thumb);
        }
      }
      emit({ ready: true, error: null, projects, currentId, thumbs });
    } catch (e) {
      console.error(e);
      loading = null; // разрешаем повторить
      emit({ ready: true, error: e, projects: {}, currentId: null, thumbs: {} });
    }
  })();
  return loading;
}

function normalize(p) {
  return {
    status: "draft",
    quantity: 1,
    options: {},
    acks: {},
    photos: [],
    ...p,
  };
}

// Кнопка «Повторить», если черновик не открылся
export function retryDraft() {
  loading = null;
  emit({ ready: false, error: null });
  return load();
}

const saveTimers = {};
function saveProject(project) {
  clearTimeout(saveTimers[project.id]);
  saveTimers[project.id] = setTimeout(() => {
    put("kv", "project:" + project.id, project).catch(console.error);
  }, 150);
}

// Подписка на изменения проектов (её использует синхронизация с сервером, lib/sync.js):
// cb({ type: "change" | "delete", id, project })
const changeListeners = new Set();
export function onProjectChange(cb) {
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}
function changed(type, id, project) {
  changeListeners.forEach((cb) => {
    try {
      cb({ type, id, project });
    } catch (e) {
      console.error(e);
    }
  });
}

// Изменить проект по id. Заказанный проект не меняется (как на сервере) — для правок есть «Заказать ещё раз».
export function updateProject(id, fn, { force = false } = {}) {
  const cur = state.projects[id];
  if (!cur) return null;
  if (cur.status === "ordered" && !force) return cur;
  const project = fn(structuredClone(cur));
  project.updatedAt = Date.now();
  emit({ projects: { ...state.projects, [id]: project } });
  saveProject(project);
  changed("change", id, project);
  return project;
}

// Служебные поля синхронизации (serverId, version, serverId фото): без отметки «изменён» и без новой синхронизации
export function updateProjectMeta(id, fn) {
  const cur = state.projects[id];
  if (!cur) return null;
  const project = fn(structuredClone(cur));
  emit({ projects: { ...state.projects, [id]: project } });
  saveProject(project);
  return project;
}

export function getDraftState() {
  return state;
}

export function whenDraftReady() {
  return state.ready ? Promise.resolve(state) : load().then(() => state);
}

// Файл фото с устройства (для загрузки на сервер)
export async function getPhotoBlob(id) {
  const rec = await get("photos", id);
  return rec?.blob || null;
}

// Небольшие значения на устройстве (IndexedDB): ключ оформления заказа и т. п.
export const kvGet = (key) => get("kv", "x:" + key);
export const kvSet = (key, val) => put("kv", "x:" + key, val);
export const kvDel = (key) => del("kv", "x:" + key);

// Проект из аккаунта (загружен с сервера) → на устройство. photos: [{ photo, blob }]
export async function importProject(project, photos) {
  if (!state.ready) await load();
  const thumbs = { ...state.thumbs };
  const list = [];
  for (const { photo, blob } of photos) {
    let thumb = null;
    try {
      thumb = blob ? (await readImage(blob)).thumb : null;
    } catch {
      // превью не получилось — фото всё равно сохраним
    }
    await put("photos", photo.id, { blob, thumb });
    if (thumb) thumbs[photo.id] = URL.createObjectURL(thumb);
    list.push(photo);
  }
  const p = normalize({ ...project, photos: list });
  await put("kv", "project:" + p.id, p);
  emit({ projects: { ...state.projects, [p.id]: p }, thumbs });
  return p;
}

// Изменить открытый проект
export function updateDraft(fn) {
  return updateProject(state.currentId, fn);
}

// Открыть проект в редакторе
export async function openProject(id) {
  if (!state.ready) await load();
  if (!state.projects[id]) return null;
  if (state.currentId !== id) {
    emit({ currentId: id });
    put("kv", "currentId", id).catch(console.error);
  }
  return state.projects[id];
}

// Новый проект. Прежние проекты не трогаем.
export async function createProject({ productSlug, sizeId, options = {}, pages, quantity = 1 }) {
  if (!state.ready) await load();
  const now = Date.now();
  const project = normalize({
    id: newId(),
    productSlug,
    sizeId,
    options,
    optionId: options.cover || options.surface || null,
    pages,
    quantity,
    createdAt: now,
    updatedAt: now,
  });
  await put("kv", "project:" + project.id, project);
  await put("kv", "currentId", project.id);
  emit({ projects: { ...state.projects, [project.id]: project }, currentId: project.id });
  changed("change", project.id, project);
  return project;
}

// Совместимость со старым кодом
export const startDraft = createProject;

export async function deleteProject(id) {
  const p = state.projects[id];
  if (!p) return;
  for (const ph of p.photos) await del("photos", ph.id).catch(() => {});
  await del("kv", "project:" + id);
  const thumbs = { ...state.thumbs };
  for (const ph of p.photos) {
    if (thumbs[ph.id]) URL.revokeObjectURL(thumbs[ph.id]);
    delete thumbs[ph.id];
  }
  const projects = { ...state.projects };
  delete projects[id];
  const currentId = state.currentId === id ? null : state.currentId;
  if (currentId !== state.currentId) await del("kv", "currentId").catch(() => {});
  emit({ projects, thumbs, currentId });
  changed("delete", id, p);
}

export function deleteDraft() {
  return deleteProject(state.currentId);
}

// «Заказать ещё раз»: копия проекта с теми же фото (новые записи фото), статус «Черновик»
export async function copyProject(id) {
  const src = state.projects[id];
  if (!src) return null;
  const thumbs = { ...state.thumbs };
  const photos = [];
  for (const ph of src.photos) {
    const rec = await get("photos", ph.id);
    if (!rec) continue;
    const nid = newId();
    await put("photos", nid, rec);
    if (rec.thumb) thumbs[nid] = URL.createObjectURL(rec.thumb);
    photos.push({ ...ph, id: nid });
  }
  const now = Date.now();
  const project = normalize({
    ...structuredClone(src),
    id: newId(),
    photos,
    status: "draft",
    acks: {},
    orderId: undefined,
    orderNumber: undefined,
    serverId: undefined,
    version: undefined,
    synced: undefined,
    pendingDeletes: undefined,
    copiedFrom: src.id,
    createdAt: now,
    updatedAt: now,
  });
  project.photos = project.photos.map((ph) => ({ ...ph, serverId: undefined }));
  await put("kv", "project:" + project.id, project);
  await put("kv", "currentId", project.id);
  emit({ projects: { ...state.projects, [project.id]: project }, currentId: project.id, thumbs });
  changed("change", project.id, project);
  return project;
}

// Статус проекта: draft «Черновик», in_cart «В корзине», ordered «Заказан» (+ номер заказа)
export async function setProjectStatus(id, status, extra = {}) {
  if (!state.ready) await load();
  return updateProject(id, (p) => ({ ...p, ...extra, status }), { force: true });
}

// Проекты, которые попали в заказ, переходят в «Заказанные»
export async function markOrdered(ids, { orderId, number }) {
  if (!state.ready) await load();
  for (const id of ids) if (state.projects[id]) await setProjectStatus(id, "ordered", { orderId, orderNumber: number, orderedAt: Date.now() });
}

// Читаем размер фото и делаем маленькое превью.
async function readImage(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = bmp.width || bmp.naturalWidth;
  const h = bmp.height || bmp.naturalHeight;
  const k = Math.min(1, 480 / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const thumb = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
  return { w, h, thumb };
}

async function makePhoto(file) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const tooBig = file.size > MAX_BYTES;
  const supported = SUPPORTED.includes(file.type) && !tooBig;
  let meta = { w: null, h: null, thumb: null };
  if (supported) {
    try {
      meta = await readImage(file);
    } catch {
      // файл повреждён — покажем как проблему
    }
  }
  await put("photos", id, { blob: file, thumb: meta.thumb });
  const photo = { id, name: file.name, type: file.type || "неизвестно", size: file.size, w: meta.w, h: meta.h, supported: supported && !!meta.w, tooBig };
  return { photo, url: meta.thumb ? URL.createObjectURL(meta.thumb) : null };
}

// Добавить фото в открытый проект. Возвращает { added, rejected, failed }.
// По каждому файлу виден ход обработки (state.uploads): «готовим» → готово или «ошибка» с кнопкой «Повторить».
function setUpload(id, patch) {
  const list = state.uploads.filter((u) => u.id !== id);
  emit({ uploads: patch ? [...list, { id, ...patch }] : list });
}

export async function addFiles(fileList) {
  const files = Array.from(fileList);
  const projectId = state.currentId;
  let added = 0;
  let failed = 0;
  const rejected = [];
  const queue = files.map((file) => ({ file, uid: newId() }));
  for (const { file, uid } of queue) setUpload(uid, { name: file.name, status: "wait", file });
  for (const { file, uid } of queue) {
    const looksImage = file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);
    if (!looksImage) {
      rejected.push(file.name);
      setUpload(uid, null);
      continue;
    }
    setUpload(uid, { name: file.name, status: "work", file });
    try {
      const { photo, url } = await makePhoto(file);
      if (url) emit({ thumbs: { ...state.thumbs, [photo.id]: url } });
      updateProject(projectId, (d) => ({ ...d, photos: [...d.photos, photo] }));
      setUpload(uid, null);
      added++;
    } catch (e) {
      console.error(e);
      failed++;
      setUpload(uid, { name: file.name, status: "error", file });
    }
  }
  return { added, rejected, failed };
}

// Повторить обработку фото, которое не добавилось
export function retryUpload(id) {
  const u = state.uploads.find((x) => x.id === id);
  if (!u) return;
  setUpload(id, null);
  return addFiles([u.file]);
}

export function dismissUpload(id) {
  setUpload(id, null);
}

// «Тестовая галерея» (public/demo-gallery): список фото с подписями и лицензиями
export async function loadGallery() {
  const r = await fetch("/demo-gallery/manifest.json");
  if (!r.ok) throw new Error("HTTP " + r.status);
  return (await r.json()).items;
}

// Скачать выбранные фото галереи и добавить в проект как обычные файлы
export async function addGalleryFiles(items) {
  const files = [];
  for (const it of items) {
    const r = await fetch("/demo-gallery/" + it.file);
    if (!r.ok) continue;
    const blob = await r.blob();
    files.push(new File([blob], it.file, { type: blob.type || "image/jpeg" }));
  }
  return addFiles(files);
}

// Перестановка перетаскиванием: фото с места from — на место to
export function reorderPhoto(from, to) {
  updateDraft((d) => {
    if (from === to || from < 0 || to < 0 || from >= d.photos.length || to >= d.photos.length) return d;
    const arr = [...d.photos];
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    return { ...d, photos: arr };
  });
}

// Базовое размещение фото на месте: fit — «cover» (заполнить, края обрежутся) или «contain» (целиком, с полями);
// focus — какая часть кадра важнее при обрезке («50% 50%» — центр)
export function setPhotoPlacement(id, patch) {
  updateDraft((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
}

export async function replacePhoto(oldId, file) {
  const { photo, url } = await makePhoto(file);
  const thumbs = { ...state.thumbs };
  if (thumbs[oldId]) URL.revokeObjectURL(thumbs[oldId]);
  delete thumbs[oldId];
  if (url) thumbs[photo.id] = url;
  emit({ thumbs });
  updateDraft((d) => ({
    ...d,
    pendingDeletes: withServerDelete(d, oldId),
    photos: d.photos.map((p) => (p.id === oldId ? photo : p)),
  }));
  del("photos", oldId).catch(() => {});
  return photo;
}

// Фото уже на сервере — запомним, чтобы синхронизация удалила его и там
function withServerDelete(d, photoId) {
  const sid = d.photos.find((p) => p.id === photoId)?.serverId;
  return sid ? [...(d.pendingDeletes || []), sid] : d.pendingDeletes;
}

export function removePhoto(id) {
  updateDraft((d) => ({ ...d, pendingDeletes: withServerDelete(d, id), photos: d.photos.filter((p) => p.id !== id) }));
  del("photos", id).catch(() => {});
}

export function movePhoto(id, delta) {
  updateDraft((d) => {
    const i = d.photos.findIndex((p) => p.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= d.photos.length) return d;
    const arr = [...d.photos];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...d, photos: arr };
  });
}

// Хук: состояние проектов на устройстве. На сервере и до чтения IndexedDB — «ещё не готово».
const SERVER_STATE = { ready: false, error: null, projects: {}, currentId: null, draft: null, thumbs: {}, uploads: [] };
function subscribe(listener) {
  listeners.add(listener);
  load();
  return () => listeners.delete(listener);
}
export function useDraft() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}
