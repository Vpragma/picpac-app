"use client";
// Корзина. Гость — на устройстве (localStorage «picpac:cart»). Вошедший клиент — на сервере (/api/v1/cart),
// поэтому её видно с другого устройства. Позиция, добавленная на устройстве (в том числе гостем до входа),
// сначала ждёт, пока проект и фото уйдут на сервер (lib/sync.js), затем попадает в серверную корзину (PUT /api/v1/cart).
import { useSyncExternalStore } from "react";
import { track } from "./analytics";
import { callApi } from "./api";
import { getDraftState, setProjectStatus, updateProject, whenDraftReady } from "./draft";
import { getMe, isClient, onMeChange, refreshMe } from "./me";
import { readKey, writeKey } from "./store";
import { syncProject } from "./sync";

// mode: "guest" | "server"; local — позиции на устройстве; server — позиции серверной корзины (цены считает сервер)
let state = { ready: false, mode: "guest", local: [], server: [], error: null, moving: false };
const listeners = new Set();
function emit(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

const readLocal = () => readKey("cart", []).filter((c) => c && c.projectId);
function writeLocal(list) {
  writeKey("cart", list);
  emit({ local: list });
}

let loading = null;
function load() {
  if (loading) return loading;
  loading = (async () => {
    const me = await getMe();
    const mode = isClient(me) ? "server" : "guest";
    emit({ mode, local: readLocal() });
    if (mode === "server") {
      await refreshServerCart();
      moveLocalToServer();
    }
    emit({ ready: true });
    // Сбой GET /me при открытии: как только сервер ответит «клиент», корзина переходит на сервер и переносит позиции
    onMeChange((m) => {
      if (isClient(m) && state.mode !== "server") {
        emit({ mode: "server", error: null });
        refreshServerCart().then(() => moveLocalToServer());
      }
    });
    if (typeof window !== "undefined") {
      window.addEventListener("picpac-store", (e) => {
        if (e.detail === "cart") emit({ local: readLocal() });
      });
      window.addEventListener("storage", () => emit({ local: readLocal() }));
      window.addEventListener("online", () => state.mode === "server" && moveLocalToServer());
    }
  })();
  return loading;
}

export async function refreshServerCart() {
  const r = await callApi("/api/v1/cart", { method: "GET" });
  if (r.ok) emit({ server: r.cart.items, error: null });
  else emit({ error: r.error?.message || "Корзина не загрузилась." });
  return r;
}

const serverPayload = (items) => items.map((i) => ({ projectId: i.projectId, quantity: i.quantity }));

async function putServer(items) {
  const r = await callApi("/api/v1/cart", { method: "PUT", body: { items: serverPayload(items) } });
  if (r.ok) emit({ server: r.cart.items, error: null });
  return r;
}

// Перенести позиции устройства в серверную корзину: проект и фото → сервер, затем позиция.
// Повторный вызов во время переноса возвращает тот же промис (оформление заказа ждёт его окончания).
let moving = null;
let moveRetries = 0;
export function moveLocalToServer() {
  if (state.mode !== "server") return Promise.resolve();
  if (!moving) moving = doMove().finally(() => (moving = null));
  return moving;
}
async function doMove() {
  emit({ moving: true });
  let failed = false;
  try {
    await whenDraftReady();
    for (const entry of readLocal()) {
      const project = getDraftState().projects[entry.projectId];
      const rest = () => readLocal().filter((c) => c.projectId !== entry.projectId);
      if (!project || project.status === "ordered") {
        writeLocal(rest());
        continue;
      }
      const ok = await syncProject(entry.projectId);
      const sid = getDraftState().projects[entry.projectId]?.serverId;
      if (!ok || !sid) {
        const offline = navigator.onLine === false;
        emit({ error: offline ? "Нет сети: корзина перенесётся в аккаунт, когда связь вернётся." : "Не все фото загрузились. Пробуем ещё раз…" });
        failed = !offline;
        break;
      }
      const items = [...state.server.filter((i) => i.projectId !== sid), { projectId: sid, quantity: entry.quantity || 1 }];
      const r = await putServer(items);
      if (r.ok || r.status === 409 || r.status === 404) writeLocal(rest());
      else {
        emit({ error: r.error?.message || "Корзина не сохранилась на сервере." });
        failed = r.status !== 0;
        break;
      }
    }
    if (!readLocal().length) {
      moveRetries = 0;
      emit({ error: null });
    }
  } finally {
    emit({ moving: false });
  }
  // Ошибка сервера — повторим с нарастающей паузой: 5, 10, 20 с, дальше раз в 30 с (до 10 раз; N7: раньше — каждые 5 с);
  // без сети — по событию online; дальше — кнопка «Повторить»
  if (failed && moveRetries++ < 10) setTimeout(moveLocalToServer, [5000, 10000, 20000][moveRetries - 1] ?? 30000);
  else if (failed) emit({ error: "Не удалось перенести корзину в аккаунт. Нажмите «Повторить»." });
}

// Текущая ошибка переноса (экран корзины не дублирует её своим сообщением)
export const cartMoveError = () => state.error;

// Кнопка «Повторить» в корзине: заново спросить, кто вошёл, и перенести позиции устройства
export async function retryMove() {
  moveRetries = 0;
  emit({ error: null });
  const m = await refreshMe();
  if (m.unknown) {
    emit({ error: "Сервер не отвечает. Проверьте интернет и нажмите «Повторить»." });
    return;
  }
  if (isClient(m) && state.mode !== "server") {
    emit({ mode: "server" });
    await refreshServerCart();
  }
  return moveLocalToServer();
}

// «В корзину» из редактора. entry: { projectId, productSlug, name, sizeId, pages, quantity, options, photoCount, cover }
export async function addToCart(entry) {
  await load();
  writeLocal([...readLocal().filter((c) => c.projectId !== entry.projectId), { ...entry, id: "c" + Date.now() }]);
  // N2: «полёт» миниатюры в корзину (components/MotionFx.js)
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("picpac-cart-add", { detail: { cover: typeof entry.cover === "string" ? entry.cover : null } }));
  await setProjectStatus(entry.projectId, "in_cart");
  track("cart_add", { props: /^[a-z0-9-]{1,40}$/.test(entry.productSlug || "") ? { product: entry.productSlug } : undefined });
  if (state.mode === "server") moveLocalToServer();
}

// Количество позиции (line из useCartLines)
export async function setLineQuantity(line, quantity) {
  const q = Math.max(1, Math.min(99, quantity));
  if (line.localProjectId) updateProject(line.localProjectId, (p) => ({ ...p, quantity: q }));
  if (line.source === "local") {
    writeLocal(readLocal().map((c) => (c.projectId === line.localProjectId ? { ...c, quantity: q } : c)));
    return { ok: true };
  }
  const prev = state.server;
  // Мгновенно на экране, затем сервер пересчитывает и подтверждает
  emit({ server: prev.map((i) => (i.projectId === line.serverProjectId ? { ...i, quantity: q, lineTotalKop: i.unitPriceKop == null ? null : i.unitPriceKop * q } : i)) });
  const r = await putServer(state.server);
  if (!r.ok) emit({ server: prev, error: r.error?.message || "Не получилось изменить количество." });
  return r;
}

export async function removeLine(line) {
  if (line.localProjectId) setProjectStatus(line.localProjectId, "draft").catch(console.error);
  if (line.source === "local") {
    writeLocal(readLocal().filter((c) => c.projectId !== line.localProjectId));
    return { ok: true };
  }
  const prev = state.server;
  emit({ server: prev.filter((i) => i.projectId !== line.serverProjectId) });
  const r = await putServer(state.server);
  if (!r.ok) emit({ server: prev, error: r.error?.message || "Не получилось убрать позицию." });
  return r;
}

// После оформления заказа сервер уже очистил корзину
export function clearAfterOrder() {
  writeLocal([]);
  emit({ server: [] });
}

function subscribe(l) {
  listeners.add(l);
  load();
  return () => listeners.delete(l);
}
const SERVER_STATE = { ready: false, mode: "guest", local: [], server: [], error: null, moving: false };
export function useCart() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER_STATE);
}

// Число позиций для значка в шапке
export function cartCount(s) {
  if (s.mode !== "server") return s.local.length;
  const onServer = new Set(s.server.map((i) => i.projectId));
  const projects = getDraftState().projects;
  return s.server.length + s.local.filter((c) => !onServer.has(projects[c.projectId]?.serverId)).length;
}
