"use client";
// Синхронизация проектов устройства с аккаунтом. Только для вошедшего клиента — гость работает на устройстве.
//
// Как устроено:
// - любое изменение проекта (lib/draft.js → onProjectChange) ставит его в очередь с задержкой 1,2 с (debounce);
// - отправка проекта: POST /api/v1/projects (если его ещё нет на сервере) → для каждого нового фото
//   upload-url → PUT файла в хранилище → POST photos → удаление убранных фото → PATCH photos/order → PATCH options с version;
// - 409 version_conflict (проект изменили на другом устройстве): перечитываем проект и повторяем с новой версией —
//   правки этого устройства новее, они ложатся поверх;
// - нет сети: проект ждёт события online и отправляется сам; ошибка сервера — повтор через 15 с (до 5 раз);
// - после входа гостевые проекты (без владельца) переносятся в аккаунт, а проекты аккаунта загружаются на устройство.
// serverId, version и serverId фото хранятся в самом проекте (IndexedDB), поэтому переживают перезагрузку.
import { compactEdits, normEdits } from "./photo/edits";
import { useSyncExternalStore } from "react";
import { callApi } from "./api";
import { getDraftState, getPhotoBlob, hasPhotoBlob, importProjectMeta, kvGet, kvSet, onProjectChange, setPhotoFetcher, updateProjectMeta, whenDraftReady } from "./draft";
import { getMe, isClient, onMeChange } from "./me";

const DEBOUNCE_MS = 1200;
const RETRY_MS = 15000;
const OPTION_KEYS = ["cover", "lamination", "paper", "print", "surface"];

let me = null;
let starting = null; // запуск: getMe → чтение проектов → включение
let initial = null; // первая отправка и загрузка проектов аккаунта
const timers = {};
const running = {};
const again = {};
const retries = {};

// Состояние для экранов: { enabled, projects: { id: { state, done, total, message } } }
// state: "pending" | "syncing" | "synced" | "offline" | "error"
// listLoaded — список проектов аккаунта уже получен; photosLeft/photosTotal — докачка фото из аккаунта
let view = { enabled: false, pulling: false, listLoaded: false, photosLeft: 0, photosTotal: 0, projects: {} };
const listeners = new Set();
function setView(patch) {
  view = { ...view, ...patch };
  listeners.forEach((l) => l());
}
function setProjectView(id, patch) {
  setView({ projects: { ...view.projects, [id]: patch ? { ...(view.projects[id] || {}), ...patch } : undefined } });
}

class Offline extends Error {
  constructor() {
    super("Нет связи с сервером");
    this.offline = true;
  }
}

// Ответ API или исключение. Для 404/409 вызывающий решает сам (allow).
async function api(path, opts = {}, allow = []) {
  const res = await callApi(path, opts);
  if (res.status === 0) throw new Offline();
  if (res.ok || allow.includes(res.status)) return res;
  const err = new Error(res.error?.message || "Сервер ответил ошибкой " + res.status);
  err.status = res.status;
  err.code = res.error?.code;
  throw err;
}

// Опции проекта в формате сервера (схема PATCH /api/v1/projects/{id})
export function serverOptions(p) {
  const out = {};
  for (const k of OPTION_KEYS) if (p.options?.[k]) out[k] = p.options[k];
  if (p.sizeId) out.size = p.sizeId;
  // Страницы — только у книг (у печати фото в проекте pages = 0/1, сервер такое не примет)
  if (Number.isInteger(p.pages) && p.pages >= 2) out.pages = p.pages;
  const placement = {};
  const edits = {};
  for (const ph of p.photos || []) {
    if (ph.serverId && (ph.fit || ph.focus)) placement[ph.serverId] = { fit: ph.fit || null, focus: ph.focus || null };
    // Правки фото (S03): неразрушающие параметры, оригинал на сервере не меняется
    const e = ph.serverId && compactEdits(ph.edits);
    if (e) edits[ph.serverId] = e;
  }
  out.settings = { quantity: p.quantity || 1, acks: p.acks || {}, placement, ...(Object.keys(edits).length ? { edits } : {}) };
  return out;
}

// Нужна ли отправка: нет на сервере, есть незагруженные фото, порядок или настройки не совпадают
export function needsSync(p) {
  if (!p || p.status === "ordered") return false;
  if (!p.serverId) return true;
  if (p.pendingDeletes?.length) return true;
  if (p.photos.some((ph) => ph.supported && !ph.serverId)) return true;
  const order = p.photos.filter((ph) => ph.serverId).map((ph) => ph.serverId).join();
  if (order && order !== p.synced?.order) return true;
  return JSON.stringify(serverOptions(p)) !== p.synced?.options;
}

const current = (id) => getDraftState().projects[id];

// Одно фото: ссылка на загрузку → PUT файла в хранилище → фиксация (POST photos) → serverId в проекте
async function uploadPhoto(id, sid, ph) {
  if (!current(id)?.photos.some((x) => x.id === ph.id)) return;
  const blob = await getPhotoBlob(ph.id);
  if (!blob) return;
  const mime = blob.type === "image/png" ? "image/png" : "image/jpeg";
  const u = await api(`/api/v1/projects/${sid}/photos/upload-url`, { body: { mime, bytes: blob.size, name: String(ph.name || "").slice(0, 200) } });
  let put;
  try {
    put = await fetch(u.upload.url, { method: "PUT", headers: u.upload.headers, body: blob });
  } catch {
    throw new Offline();
  }
  if (!put.ok) throw new Error("Хранилище не приняло фото (" + put.status + ")");
  const c = await api(`/api/v1/projects/${sid}/photos`, { body: { path: u.upload.path, quality: { w: ph.w, h: ph.h, name: String(ph.name || "").slice(0, 200) } } });
  if (current(id)?.photos.some((x) => x.id === ph.id)) {
    updateProjectMeta(id, (x) => ({ ...x, photos: x.photos.map((y) => (y.id === ph.id ? { ...y, serverId: c.photo.id } : y)) }));
  } else {
    // фото убрали, пока оно загружалось
    await api(`/api/v1/projects/${sid}/photos/${c.photo.id}`, { method: "DELETE" }, [404, 409]);
  }
}

async function pushProject(id) {
  let p = current(id);
  if (!p || p.status === "ordered") return;
  // Проект другого аккаунта на этом устройстве не трогаем (выход стирает данные — S02e)
  if (p.owner && p.owner !== me.user.id) return;

  // 1. Проект
  if (!p.serverId) {
    setProjectView(id, { state: "syncing", done: 0, total: 0 });
    const r = await api("/api/v1/projects", { body: { productSlug: p.productSlug, options: serverOptions({ ...p, photos: [] }) } });
    p = updateProjectMeta(id, (x) => ({ ...x, serverId: r.project.id, version: r.project.version, owner: me.user.id, synced: { order: "", options: "" } }));
  } else if (!p.owner) {
    p = updateProjectMeta(id, (x) => ({ ...x, owner: me.user.id }));
  }
  const sid = p.serverId;

  // 2. Фото, которые убрали на устройстве
  for (const photoId of p.pendingDeletes || []) {
    await api(`/api/v1/projects/${sid}/photos/${photoId}`, { method: "DELETE" }, [404, 409]);
    p = updateProjectMeta(id, (x) => ({ ...x, pendingDeletes: (x.pendingDeletes || []).filter((s) => s !== photoId) }));
  }

  // 3. Новые фото: ссылка → файл в хранилище → фиксация на сервере (сервер сам проверяет тип и размеры).
  // По 3 фото одновременно; порядок на сервере выставляет шаг 4.
  const todo = p.photos.filter((ph) => ph.supported && !ph.serverId);
  let done = 0;
  if (todo.length) setProjectView(id, { state: "syncing", done, total: todo.length });
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      await uploadPhoto(id, sid, queue.shift());
      done++;
      setProjectView(id, { state: "syncing", done, total: todo.length });
    }
  };
  const results = await Promise.allSettled([worker(), worker(), worker()]);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;

  // 4. Порядок фото
  p = current(id);
  const order = p.photos.filter((ph) => ph.serverId).map((ph) => ph.serverId);
  if (order.length && order.join() !== p.synced?.order) {
    const r = await api(`/api/v1/projects/${sid}/photos/order`, { method: "PATCH", body: { order } }, [400]);
    if (r.status === 400) {
      // Список на сервере другой (фото удалили на другом устройстве или загрузка оборвалась): сверяем и повторим
      const g = await api(`/api/v1/projects/${sid}`, { method: "GET" });
      const onServer = new Set(g.project.photos.map((x) => x.id));
      const extra = g.project.photos.map((x) => x.id).filter((x) => !order.includes(x));
      updateProjectMeta(id, (x) => ({
        ...x,
        pendingDeletes: [...new Set([...(x.pendingDeletes || []), ...extra])],
        photos: x.photos.map((y) => (y.serverId && !onServer.has(y.serverId) ? { ...y, serverId: undefined } : y)),
      }));
      throw Object.assign(new Error("Порядок фото сверяется с сервером"), { retrySoon: true });
    }
    p = updateProjectMeta(id, (x) => ({ ...x, synced: { ...x.synced, order: order.join() } }));
  }

  // 5. Настройки (размер, страницы, обложка…, количество, кадрирование) — с версией
  const opts = serverOptions(p);
  const hash = JSON.stringify(opts);
  if (hash !== p.synced?.options) {
    let r = await api(`/api/v1/projects/${sid}`, { method: "PATCH", body: { version: p.version || 1, options: opts } }, [404, 409]);
    if (r.status === 409 && r.error?.code === "version_conflict") {
      const g = await api(`/api/v1/projects/${sid}`, { method: "GET" });
      r = await api(`/api/v1/projects/${sid}`, { method: "PATCH", body: { version: g.project.version, options: opts } }, [404, 409]);
    }
    if (r.status === 409 && r.error?.code === "project_ordered") {
      updateProjectMeta(id, (x) => ({ ...x, status: "ordered" }));
      return;
    }
    if (r.status === 404) {
      // Проект удалили на другом устройстве — создадим заново при следующей отправке
      updateProjectMeta(id, (x) => ({ ...x, serverId: undefined, version: undefined, synced: undefined, pendingDeletes: [], photos: x.photos.map((y) => ({ ...y, serverId: undefined })) }));
      throw Object.assign(new Error("Проект пропал на сервере — создаём заново"), { retrySoon: true });
    }
    if (!r.ok) throw new Error(r.error?.message || "Не получилось сохранить проект");
    updateProjectMeta(id, (x) => ({ ...x, version: r.project.version, synced: { ...x.synced, options: hash } }));
  }
}

function schedule(id, delay = DEBOUNCE_MS) {
  if (!view.enabled) return;
  clearTimeout(timers[id]);
  if (needsSync(current(id))) setProjectView(id, { state: "pending" });
  timers[id] = setTimeout(() => runProject(id), delay);
}

// Отправить один проект сейчас (или дождаться идущей отправки). true — проект на сервере и совпадает.
export async function syncProject(id) {
  await startSync();
  if (!view.enabled) return false;
  clearTimeout(timers[id]);
  await runProject(id);
  return !needsSync(current(id));
}

async function runProject(id) {
  if (running[id]) {
    again[id] = true;
    return running[id];
  }
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setProjectView(id, { state: "offline" });
    return;
  }
  running[id] = (async () => {
    try {
      await pushProject(id);
      retries[id] = 0;
      setProjectView(id, needsSync(current(id)) ? { state: "pending" } : { state: "synced", message: "" });
    } catch (e) {
      if (e.offline) {
        setProjectView(id, { state: "offline", message: "Нет сети — отправим, когда связь вернётся." });
      } else {
        console.error(e);
        retries[id] = (retries[id] || 0) + 1;
        setProjectView(id, { state: "error", message: e.message });
        if (retries[id] <= 5) {
          clearTimeout(timers[id]);
          timers[id] = setTimeout(() => runProject(id), e.retrySoon ? 500 : RETRY_MS);
        }
      }
    } finally {
      running[id] = null;
      if (again[id]) {
        again[id] = false;
        schedule(id, 300);
      }
    }
  })();
  return running[id];
}

// Отправить все проекты устройства (перед оформлением заказа и перед выходом)
export async function syncAll() {
  await startSync();
  if (!view.enabled) return true;
  await whenDraftReady();
  for (const id of Object.keys(getDraftState().projects)) {
    if (needsSync(current(id))) await runProject(id);
  }
  return !hasUnsynced();
}

// Есть ли на устройстве изменения, которых нет на сервере (для предупреждения перед выходом)
export function hasUnsynced() {
  if (!view.enabled) return false;
  return Object.values(getDraftState().projects).some((p) => needsSync(p) && (!p.owner || p.owner === me?.user.id));
}

// Удалённый на устройстве проект удаляем и в аккаунте. Без сети — запоминаем и удалим позже.
async function deleteOnServer(serverId) {
  const r = await callApi(`/api/v1/projects/${serverId}`, { method: "DELETE" });
  if (r.status === 0) {
    const list = (await kvGet("serverDeletes").catch(() => null)) || [];
    await kvSet("serverDeletes", [...new Set([...list, serverId])]).catch(() => {});
  }
}
async function flushDeletes() {
  const list = (await kvGet("serverDeletes").catch(() => null)) || [];
  const left = [];
  for (const sid of list) {
    const r = await callApi(`/api/v1/projects/${sid}`, { method: "DELETE" });
    if (r.status === 0) left.push(sid);
  }
  await kvSet("serverDeletes", left).catch(() => {});
}

// Проекты аккаунта, которых нет на устройстве (вход на новом устройстве).
// Сначала — карточки по метаданным (сразу видны в «Мои книги»), затем в фоне — файлы фото (downloadPhotos).
export async function pullAccount() {
  if (!view.enabled) return;
  setView({ pulling: true });
  try {
    const list = await api("/api/v1/projects", { method: "GET" });
    const local = new Map(Object.values(getDraftState().projects).filter((p) => p.serverId).map((p) => [p.serverId, p]));
    const missing = [];
    for (const sp of list.items) {
      const mine = local.get(sp.id);
      if (!mine) missing.push(sp);
      // Заказали с другого устройства — здесь тоже «Заказан»
      else if (sp.status === "ordered" && mine.status !== "ordered") updateProjectMeta(mine.id, (x) => ({ ...x, status: "ordered" }));
    }
    const queue = [...missing];
    const worker = async () => {
      while (queue.length) {
        const sp = queue.shift();
        const g = await api(`/api/v1/projects/${sp.id}`, { method: "GET" }, [404]);
        if (g.ok) await importProjectMeta(toLocalProject(sp, g.project));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  } catch (e) {
    if (!e.offline) console.error(e);
  } finally {
    setView({ pulling: false, listLoaded: true });
  }
}

// Проект сервера → проект устройства (фото — только описания, файлы докачиваются отдельно)
function toLocalProject(sp, gp) {
  const o = gp.options || {};
  const placement = o.settings?.placement || {};
  const photos = (gp.photos || []).map((ph, i) => ({
    id: localId(),
    serverId: ph.id,
    name: ph.quality?.name || "Фото " + (i + 1),
    type: ph.mime,
    size: ph.bytes,
    w: ph.width,
    h: ph.height,
    supported: true,
    tooBig: false,
    ...(placement[ph.id]?.fit ? { fit: placement[ph.id].fit } : {}),
    ...(placement[ph.id]?.focus ? { focus: placement[ph.id].focus } : {}),
    ...(o.settings?.edits?.[ph.id] ? { edits: normEdits(o.settings.edits[ph.id]) } : {}),
  }));
  const options = Object.fromEntries(OPTION_KEYS.filter((k) => o[k]).map((k) => [k, o[k]]));
  const project = {
    id: localId(),
    serverId: sp.id,
    version: sp.version,
    owner: me.user.id,
    productSlug: sp.productSlug,
    sizeId: o.size,
    options,
    optionId: options.cover || options.surface || null,
    pages: o.pages,
    quantity: o.settings?.quantity || 1,
    acks: o.settings?.acks || {},
    status: sp.status,
    createdAt: Date.parse(sp.createdAt) || Date.now(),
    updatedAt: Date.parse(sp.updatedAt) || Date.now(),
    photos,
  };
  project.synced = { order: photos.map((y) => y.serverId).join(), options: JSON.stringify(serverOptions(project)) };
  return project;
}

// Файл фото из аккаунта по подписанной ссылке
async function fetchPhotoBlob(ph) {
  const u = await api(`/api/v1/photos/${ph.serverId}/url`, { method: "GET" }, [404]);
  if (!u.ok) return null;
  return fetch(u.url)
    .then((r) => (r.ok ? r.blob() : null))
    .catch(() => null);
}

// Докачка фото в фоне, по 3 одновременно: сначала черновики и «В корзине» целиком,
// у заказанных — только первое фото для карточки (остальные — по требованию, например «Заказать ещё раз»)
let downloading = null;
export function downloadPhotos() {
  if (!view.enabled) return Promise.resolve();
  if (!downloading) downloading = runDownloads().finally(() => (downloading = null));
  return downloading;
}
async function runDownloads() {
  const list = Object.values(getDraftState().projects).filter((p) => p.owner === me.user.id);
  const wanted = [
    ...list.filter((p) => p.status !== "ordered").flatMap((p) => p.photos.filter((ph) => ph.serverId)),
    ...list.filter((p) => p.status === "ordered").flatMap((p) => p.photos.filter((ph) => ph.serverId).slice(0, 1)),
  ];
  const todo = [];
  for (const ph of wanted) if (!(await hasPhotoBlob(ph.id))) todo.push(ph);
  if (!todo.length) return;
  let done = 0;
  setView({ photosLeft: todo.length, photosTotal: todo.length });
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const ph = queue.shift();
      await getPhotoBlob(ph.id).catch(() => null);
      done++;
      setView({ photosLeft: todo.length - done });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  setView({ photosLeft: 0 });
}

const localId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Запуск один раз на странице (components/Shell.js). Промис выполняется, когда понятно, включена ли синхронизация;
// первая отправка и загрузка проектов аккаунта идут дальше в фоне.
export function startSync() {
  if (!starting) starting = enable();
  return starting;
}
async function enable() {
  const m = await getMe();
  if (m.unknown) {
    // Сервер не ответил, кто вошёл (нет сети или сбой): lib/me.js повторит запрос сам — включимся, когда ответ придёт
    const off = onMeChange((next) => {
      if (!next || next.unknown) return;
      off();
      starting = null;
      startSync();
    });
    return;
  }
  if (!isClient(m)) {
    setView({ listLoaded: true });
    return;
  }
  me = m;
  await whenDraftReady();
  setPhotoFetcher(fetchPhotoBlob);
  setView({ enabled: true, pulling: true });
  initial = initialSync();
}
async function initialSync() {
  onProjectChange(({ type, id, project }) => {
    if (type === "delete") {
      clearTimeout(timers[id]);
      if (project?.serverId && project.status !== "ordered" && (!project.owner || project.owner === me.user.id)) deleteOnServer(project.serverId);
      setProjectView(id, null);
      return;
    }
    schedule(id);
  });
  window.addEventListener("online", () => {
    flushDeletes();
    for (const id of Object.keys(getDraftState().projects)) if (needsSync(current(id))) schedule(id, 300);
  });
  // Сначала карточки проектов аккаунта (быстро, по метаданным), затем отправка изменений устройства, затем фото
  await pullAccount();
  await flushDeletes();
  await syncAll();
  await downloadPhotos();
}

// Дождаться первой синхронизации после входа (перенос гостевых проектов и загрузка проектов аккаунта)
export async function whenInitialSync() {
  await startSync();
  return initial;
}

export function useSyncState() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
    () => view,
  );
}
