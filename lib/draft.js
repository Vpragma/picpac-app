"use client";
// Черновик книги в IndexedDB: продукт, настройки, фото и их порядок.
// Переживает перезагрузку страницы. Фото хранятся отдельно от настроек,
// чтобы перестановка не перезаписывала большие файлы.
import { useEffect, useState } from "react";

const DB_NAME = "picpac";
const SUPPORTED = ["image/jpeg", "image/png"];

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
const clearStore = (store) => idb(store, "readwrite", (s) => s.clear());

// --- общее состояние для всех экранов ---
let state = { ready: false, draft: null, thumbs: {} };
const listeners = new Set();
function emit(next) {
  state = { ...state, ...next };
  listeners.forEach((l) => l(state));
}
let loading = null;
async function load() {
  if (loading) return loading;
  loading = (async () => {
    try {
      const draft = (await get("kv", "draft")) || null;
      const thumbs = {};
      if (draft) {
        for (const p of draft.photos) {
          const rec = await get("photos", p.id);
          if (rec?.thumb) thumbs[p.id] = URL.createObjectURL(rec.thumb);
        }
      }
      emit({ ready: true, draft, thumbs });
    } catch (e) {
      console.error(e);
      emit({ ready: true, draft: null, thumbs: {} });
    }
  })();
  return loading;
}

let saveTimer = null;
function saveMeta(draft) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    put("kv", "draft", draft).catch(console.error);
  }, 150);
}

export function updateDraft(fn) {
  const draft = fn(structuredClone(state.draft));
  draft.updatedAt = Date.now();
  emit({ draft });
  saveMeta(draft);
  return draft;
}

export async function startDraft({ productSlug, sizeId, optionId, pages }) {
  const old = state.draft;
  // Тот же продукт — оставляем фото, меняем только настройки.
  if (old && old.productSlug === productSlug) {
    return updateDraft((d) => ({ ...d, sizeId, optionId, pages, acks: {} }));
  }
  await clearStore("photos");
  Object.values(state.thumbs).forEach((u) => URL.revokeObjectURL(u));
  const draft = { productSlug, sizeId, optionId, pages, photos: [], acks: {}, createdAt: Date.now(), updatedAt: Date.now() };
  emit({ draft, thumbs: {} });
  await put("kv", "draft", draft);
  return draft;
}

export async function deleteDraft() {
  await clearStore("photos");
  await del("kv", "draft");
  Object.values(state.thumbs).forEach((u) => URL.revokeObjectURL(u));
  emit({ draft: null, thumbs: {} });
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
  const supported = SUPPORTED.includes(file.type);
  let meta = { w: null, h: null, thumb: null };
  if (supported) {
    try {
      meta = await readImage(file);
    } catch {
      // файл повреждён — покажем как проблему
    }
  }
  await put("photos", id, { blob: file, thumb: meta.thumb });
  const photo = { id, name: file.name, type: file.type || "неизвестно", size: file.size, w: meta.w, h: meta.h, supported: supported && !!meta.w };
  return { photo, url: meta.thumb ? URL.createObjectURL(meta.thumb) : null };
}

// Добавить фото. Возвращает { added, rejected }.
export async function addFiles(fileList) {
  const files = Array.from(fileList);
  let added = 0;
  const rejected = [];
  for (const file of files) {
    const looksImage = file.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);
    if (!looksImage) {
      rejected.push(file.name);
      continue;
    }
    const { photo, url } = await makePhoto(file);
    if (url) emit({ thumbs: { ...state.thumbs, [photo.id]: url } });
    updateDraft((d) => ({ ...d, photos: [...d.photos, photo] }));
    added++;
  }
  return { added, rejected };
}

export async function replacePhoto(oldId, file) {
  const { photo, url } = await makePhoto(file);
  const thumbs = { ...state.thumbs };
  if (thumbs[oldId]) URL.revokeObjectURL(thumbs[oldId]);
  delete thumbs[oldId];
  if (url) thumbs[photo.id] = url;
  emit({ thumbs });
  updateDraft((d) => ({ ...d, photos: d.photos.map((p) => (p.id === oldId ? photo : p)) }));
  del("photos", oldId).catch(() => {});
  return photo;
}

export function removePhoto(id) {
  updateDraft((d) => ({ ...d, photos: d.photos.filter((p) => p.id !== id) }));
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

export function useDraft() {
  const [s, setS] = useState(state);
  useEffect(() => {
    listeners.add(setS);
    setS(state);
    load();
    return () => listeners.delete(setS);
  }, []);
  return s;
}
