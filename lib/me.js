"use client";
// Кто вошёл: один общий запрос GET /api/v1/me на все экраны (кэш до перезагрузки страницы).
// Вход и выход делают полную перезагрузку (lib/api.js → goTo), поэтому кэш не устаревает.
import { useSyncExternalStore } from "react";
import { callApi } from "./api";

let me = null; // { authenticated, user, activeRole } или { offline: true }
let inflight = null;
const listeners = new Set();

export function getMe() {
  if (me && !me.offline) return Promise.resolve(me);
  if (!inflight) {
    inflight = callApi("/api/v1/me", { method: "GET" })
      .then((res) => {
        me = res.status === 200 ? res : { authenticated: false, offline: res.status === 0 };
        listeners.forEach((l) => l());
        return me;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Вошёл клиент (заказы, корзина и проекты на сервере доступны только роли «Клиент»)
export function isClient(m) {
  return !!(m?.authenticated && m.activeRole === "client");
}

function subscribe(l) {
  listeners.add(l);
  getMe();
  return () => listeners.delete(l);
}
export function useMe() {
  return useSyncExternalStore(subscribe, () => me, () => null);
}
