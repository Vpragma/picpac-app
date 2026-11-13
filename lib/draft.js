"use client";
// Черновик книги в IndexedDB: продукт, настройки, фото и их порядок.
// Переживает перезагрузку страницы. Фото хранятся отдельно от настроек,
// чтобы перестановка не перезаписывала большие файлы.
import { track } from "./analytics";
import { DATE_MAX, TITLE_MAX, cleanText, initialBook, normBook } from "./book";
import { sniffImage, tooManyPixels } from "./imageMeta";
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

let wiped = false; // после выхода из аккаунта до перезагрузки страницы ничего не записываем
async function idb(store, mode, fn) {
  if (wiped && mode === "readwrite") return undefined;
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

// Выход из аккаунта: стереть с устройства все проекты, фото и служебные ключи
// (kv: project:*, currentId, x:checkoutKey, x:serverDeletes; photos). После этого страница перезагружается.
export async function wipeDeviceData() {
  wiped = true;
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(["kv", "photos"], "readwrite");
    tx.objectStore("kv").clear();
    tx.objectStore("photos").clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  for (const u of Object.values(state.thumbs)) URL.revokeObjectURL(u);
  state = { ...state, projects: {}, currentId: null, draft: null, thumbs: {}, uploads: [] };
}

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

// Запись проекта в IndexedDB не позже чем через 0,15 с после изменения (а не после конца серии изменений:
// при быстром добавлении 12 фото отложенная запись иначе сдвигалась бы до последнего фото).
// Пишется самая свежая версия проекта; удалённый проект не воскрешается. При уходе со страницы — сразу.
const saveTimers = {};
function writeLatest(id) {
  clearTimeout(saveTimers[id]);
  delete saveTimers[id];
  const latest = state.projects[id];
  if (latest) put("kv", "project:" + id, latest).catch(console.error);
}
function saveProject(project) {
  if (saveTimers[project.id]) return;
  saveTimers[project.id] = setTimeout(() => writeLatest(project.id), 150);
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => Object.keys(saveTimers).forEach(writeLatest));
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
  if (rec?.blob) return rec.blob;
  // Фото из аккаунта, которое ещё не докачалось, — скачать сейчас
  const ph = findPhoto(id);
  if (ph?.serverId && photoFetcher) return (await fetchMissing(ph)) || null;
  return null;
}

// Файл фото, который уже есть на устройстве (без докачки из аккаунта): чёткое превью книги (N7 D4)
export async function getLocalPhotoBlob(id) {
  return (await get("photos", id).catch(() => null))?.blob || null;
}

// Докачка фото из аккаунта (её задаёт lib/sync.js): fetcher(photo) → Blob | null
let photoFetcher = null;
export function setPhotoFetcher(fn) {
  photoFetcher = fn;
}
function findPhoto(id) {
  for (const p of Object.values(state.projects)) {
    const ph = p.photos.find((x) => x.id === id);
    if (ph) return ph;
  }
  return null;
}
const fetching = {};
function fetchMissing(ph) {
  if (!fetching[ph.id]) {
    fetching[ph.id] = (async () => {
      const blob = await photoFetcher(ph).catch(() => null);
      if (blob) await attachPhotoBlob(ph.id, blob);
      return blob;
    })().finally(() => delete fetching[ph.id]);
  }
  return fetching[ph.id];
}

// Есть ли файл фото на устройстве
export async function hasPhotoBlob(id) {
  return !!(await get("photos", id))?.blob;
}

// Файл фото, скачанный из аккаунта: сохранить и показать превью
export async function attachPhotoBlob(id, blob) {
  let thumb = blob.size <= 1_500_000 ? blob : null;
  if (!thumb) {
    try {
      thumb = (await readImage(blob)).thumb;
    } catch {
      // превью не получилось — фото всё равно сохраним
    }
  }
  await put("photos", id, { blob, thumb });
  if (thumb) emit({ thumbs: { ...state.thumbs, [id]: URL.createObjectURL(thumb) } });
}

// Проект из аккаунта по метаданным — сразу виден в «Мои книги»; файлы фото докачиваются отдельно
export async function importProjectMeta(project) {
  if (!state.ready) await load();
  const p = normalize(project);
  await put("kv", "project:" + p.id, p);
  emit({ projects: { ...state.projects, [p.id]: p } });
  return p;
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
    // Небольшой файл сам служит превью (без перерисовки на canvas — это быстрее, особенно в фоновой вкладке)
    let thumb = blob && blob.size <= 1_500_000 ? blob : null;
    if (blob && !thumb) {
      try {
        thumb = (await readImage(blob)).thumb;
      } catch {
        // превью не получилось — фото всё равно сохраним
      }
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
    // N11: книга в сезон «Осень» — сразу с осенним шаблоном (у печати фото страниц нет: pages 0)
    ...(pages >= 2 && initialBook(currentSeason()) ? { book: initialBook(currentSeason()) } : {}),
    createdAt: now,
    updatedAt: now,
  });
  await put("kv", "project:" + project.id, project);
  await put("kv", "currentId", project.id);
  emit({ projects: { ...state.projects, [project.id]: project }, currentId: project.id });
  changed("change", project.id, project);
  track("project_create", { props: { product: productSlug } });
  return project;
}

// Совместимость со старым кодом
export const startDraft = createProject;

// Сезон сайта ставит сервер атрибутом на <html> (lib/season.js) — без запросов
function currentSeason() {
  return typeof document === "undefined" ? "none" : document.documentElement.dataset.season || "none";
}

// N11: оформление книги открытого проекта — шаблон, обложка (название, дата, вариант расположения).
// Текст пока не обрезаем по краям (клиент печатает), окончательно чистит normBook при отправке и в заказе.
export function setBook(patch) {
  return updateDraft((d) => {
    const cur = normBook(d.book);
    const cover = { ...cur.cover, ...(d.book?.cover || {}), ...(patch.cover || {}) };
    const next = normBook({ ...cur, ...patch, cover });
    next.cover.title = cleanText(cover.title, TITLE_MAX);
    next.cover.date = cleanText(cover.date, DATE_MAX);
    return { ...d, book: next };
  });
}

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
    let rec = await get("photos", ph.id);
    if (!rec?.blob && ph.serverId && photoFetcher) {
      // Заказанный проект из аккаунта: фото скачиваются по требованию
      await fetchMissing(ph);
      rec = await get("photos", ph.id);
    }
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
  // Больше 100 Мп — не декодируем вовсе (иначе вкладка может упасть от нехватки памяти)
  let hugePx = null;
  if (!tooBig && SUPPORTED.includes(file.type)) {
    try {
      const head = sniffImage(new Uint8Array(await file.slice(0, 524288).arrayBuffer()));
      if (tooManyPixels(head)) hugePx = head;
    } catch {
      // не прочитали заголовок — решит обычная проверка ниже
    }
  }
  const supported = SUPPORTED.includes(file.type) && !tooBig && !hugePx;
  let meta = hugePx ? { w: hugePx.width, h: hugePx.height, thumb: null } : { w: null, h: null, thumb: null };
  if (supported) {
    try {
      meta = await readImage(file);
    } catch {
      // файл повреждён — покажем как проблему
    }
  }
  await put("photos", id, { blob: file, thumb: meta.thumb });
  const photo = { id, name: file.name, type: file.type || "неизвестно", size: file.size, w: meta.w, h: meta.h, supported: supported && !!meta.w, tooBig, ...(hugePx ? { tooManyPixels: true } : {}) };
  return { photo, url: meta.thumb ? URL.createObjectURL(meta.thumb) : null };
}

// Добавить фото в открытый проект. Возвращает { added, rejected, failed }.
// По каждому файлу виден ход обработки (state.uploads): «готовим» → готово или «ошибка» с кнопкой «Повторить».
function setUpload(id, patch) {
  const list = state.uploads.filter((u) => u.id !== id);
  emit({ uploads: patch ? [...list, { id, ...patch }] : list });
}

// W-13 (D5): пока выбранные фото читаются и сохраняются на устройство, уход со страницы их потеряет —
// только на это время браузер спросит «Покинуть сайт?». В остальное время beforeunload не ставим:
// черновик сохраняется сам, очередь загрузки в аккаунт переживает закрытие, а слушатель мешает быстрому «Назад».
let savingFiles = 0;
const stopLeave = (e) => {
  e.preventDefault();
  e.returnValue = "";
};
function guardLeave(on) {
  if (typeof window === "undefined") return;
  savingFiles = Math.max(0, savingFiles + (on ? 1 : -1));
  if (on && savingFiles === 1) window.addEventListener("beforeunload", stopLeave);
  if (!on && savingFiles === 0) window.removeEventListener("beforeunload", stopLeave);
}

export async function addFiles(fileList) {
  guardLeave(true);
  try {
    return await addFilesNow(fileList);
  } finally {
    guardLeave(false);
  }
}

async function addFilesNow(fileList) {
  const files = Array.from(fileList);
  const projectId = state.currentId;
  let added = 0;
  // N7: файл не того типа или слишком большой добавлен ячейкой с проблемой — в «Добавлено фото» его не считаем
  let unsupported = 0;
  let tooLarge = 0;
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
      if (photo.supported) added++;
      else if (photo.tooBig || photo.tooManyPixels) tooLarge++;
      else unsupported++;
    } catch (e) {
      console.error(e);
      failed++;
      setUpload(uid, { name: file.name, status: "error", file });
    }
  }
  if (added) track("photo_upload", { props: { count: added } });
  return { added, unsupported, tooLarge, rejected, failed };
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

// Скачать выбранные фото галереи и добавить в проект как обычные файлы. Медленная сеть (площадка ~1,4 Мбит/с):
// по одному, с тайм-аутом и одним повтором; onProgress({ done, total }) — для «Добавлено N из 12».
// Не скачались — их список в missing (кнопка «Повторить» добавит только их).
const GALLERY_TIMEOUT = 90_000;
async function fetchGalleryFile(it) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch("/demo-gallery/" + it.file, { signal: AbortSignal.timeout(GALLERY_TIMEOUT) });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const blob = await r.blob();
      return new File([blob], it.file, { type: blob.type || "image/jpeg" });
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
}

// N3 (баг N7): фото появляются в проекте по одному, сразу как скачались, — на медленной сети не ждём все 12
export async function addGalleryFiles(items, onProgress = () => {}) {
  const missing = [];
  const res = { added: 0, rejected: [], failed: 0 };
  let done = 0;
  onProgress({ done, total: items.length });
  for (const it of items) {
    let file = null;
    try {
      file = await fetchGalleryFile(it);
    } catch {
      missing.push(it);
    }
    if (file) {
      const r = await addFiles([file]);
      res.added += r.added || 0;
      res.rejected.push(...(r.rejected || []));
      res.failed += r.failed || 0;
    }
    done++;
    onProgress({ done, total: items.length });
  }
  return { ...res, missing };
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

// Правки фото (S03): photo.edits — неразрушающие параметры (lib/photo/adjust.js), оригинал в IndexedDB не меняется
export function setPhotoEdits(id, edits) {
  updateDraft((d) => ({ ...d, photos: d.photos.map((p) => (p.id === id ? { ...p, edits } : p)) }));
}

// Изменить все фото открытого проекта одной записью (например, «Отменить все улучшения»)
export function mapDraftPhotos(fn) {
  updateDraft((d) => ({ ...d, photos: d.photos.map(fn) }));
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

// Удаление дублей с «Вернуть»: фото сразу уходят из проекта, а файл на устройстве и на сервере стираются только
// в commit() — когда вернуть уже нельзя (тост закрылся). undo() ставит фото на прежние места.
export function removePhotosUndoable(ids) {
  const set = new Set(ids);
  const pid = state.currentId;
  const cur = pid && state.projects[pid];
  const removed = (cur?.photos || []).map((p, i) => ({ p, i })).filter((x) => set.has(x.p.id));
  if (!removed.length) return null;
  updateProject(pid, (d) => ({ ...d, photos: d.photos.filter((p) => !set.has(p.id)) }));
  let settled = false;
  return {
    count: removed.length,
    undo() {
      if (settled) return;
      settled = true;
      updateProject(pid, (d) => {
        const arr = d.photos.filter((p) => !set.has(p.id));
        for (const { p, i } of removed) arr.splice(Math.min(i, arr.length), 0, p);
        return { ...d, photos: arr };
      });
    },
    commit() {
      if (settled) return;
      settled = true;
      const sids = removed.map(({ p }) => p.serverId).filter(Boolean);
      if (sids.length) updateProject(pid, (d) => ({ ...d, pendingDeletes: [...new Set([...(d.pendingDeletes || []), ...sids])] }));
      for (const { p } of removed) del("photos", p.id).catch(() => {});
    },
  };
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
