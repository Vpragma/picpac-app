"use client";
// Кто вошёл: один общий запрос GET /api/v1/me на все экраны (кэш до перезагрузки страницы).
// Вход и выход делают полную перезагрузку (lib/api.js → goTo), поэтому кэш не устаревает.
//
// «Гость» — только если сервер так ответил (200 { authenticated: false } или 401).
// Сбой (нет сети, 5xx, 429, непонятный ответ) — это «пока неизвестно» ({ unknown: true }):
// повторяем с отсрочкой 1, 2, 4… до 30 с и сразу при появлении сети. Когда ответ придёт,
// подписчики (корзина, синхронизация, экраны) узнают новое значение и переключатся сами.
import { useSyncExternalStore } from "react";
import { callApi } from "./api.js";

let me = null; // { authenticated, user, activeRole } | { authenticated: false } | { authenticated: false, unknown: true, offline }
let inflight = null;
let attempt = 0;
let retryTimer = null;
const listeners = new Set();
const emit = () => listeners.forEach((l) => l());

// Разобрать ответ GET /api/v1/me (чистая функция — её проверяет unit-тест)
export function meFromResponse(res) {
  if (res.status === 200 && res.ok !== false) return res;
  if (res.status === 401) return { authenticated: false };
  return { authenticated: false, unknown: true, offline: res.status === 0 };
}

// Отсрочка повтора после n-го сбоя подряд: 1, 2, 4, 8, 16, 30, 30… с
export const retryDelay = (n) => Math.min(30000, 1000 * 2 ** Math.max(0, n - 1));

export function getMe() {
  if (me && !me.unknown) return Promise.resolve(me);
  if (!inflight) {
    inflight = callApi("/api/v1/me", { method: "GET" })
      .then((res) => {
        me = meFromResponse(res);
        if (me.unknown) scheduleRetry();
        else attempt = 0;
        emit();
        return me;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

function scheduleRetry() {
  if (typeof window === "undefined" || retryTimer) return;
  attempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    getMe();
  }, retryDelay(attempt));
}

// Спросить сервер ещё раз сейчас (кнопка «Повторить»)
export function refreshMe() {
  if (me && !me.unknown) return Promise.resolve(me);
  clearTimeout(retryTimer);
  retryTimer = null;
  return getMe();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => me?.unknown && refreshMe());
}

// Забыть, кто вошёл (выход из аккаунта)
export function resetMe() {
  me = null;
  emit();
}

// Вошёл клиент (заказы, корзина и проекты на сервере доступны только роли «Клиент»)
export function isClient(m) {
  return !!(m?.authenticated && m.activeRole === "client");
}

// Подписка на смену «кто вошёл» (корзина и синхронизация переключают режим)
export function onMeChange(cb) {
  const l = () => cb(me);
  listeners.add(l);
  return () => listeners.delete(l);
}

function subscribe(l) {
  listeners.add(l);
  getMe();
  return () => listeners.delete(l);
}
export function useMe() {
  return useSyncExternalStore(subscribe, () => me, () => null);
}
