"use client";
// Простое хранилище на устройстве (localStorage): гостевая корзина, форма оформления, адреса, уведомления.
// Ключи начинаются с «picpac:» — при выходе из аккаунта они стираются (lib/device.js).
// Вход и роли здесь НЕ хранятся: их проверяет сервер (httpOnly-cookies + база).
import { useSyncExternalStore } from "react";

const EVENT = "picpac-store";

export function readKey(key, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem("picpac:" + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeKey(key, value) {
  try {
    window.localStorage.setItem("picpac:" + key, JSON.stringify(value));
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

// Хук: значение из хранилища, обновляется при любом изменении; ready — false только при отрисовке на сервере.
const noSubscribe = () => () => {};
export function useStored(key, fallback) {
  const [value, set] = useLocalValue(key, fallback);
  const ready = useSyncExternalStore(noSubscribe, () => true, () => false);
  return [value, set, ready];
}

// Хук без эффектов (useSyncExternalStore): значение из хранилища устройства и функция записи.
// fallback должен быть постоянным объектом (объявленным вне компонента).
const snapCache = new Map();
function snapshot(key, fallback) {
  let raw = null;
  try {
    raw = window.localStorage.getItem("picpac:" + key);
  } catch {}
  const c = snapCache.get(key);
  if (c && c.raw === raw) return c.value;
  let value = fallback;
  try {
    value = raw ? JSON.parse(raw) : fallback;
  } catch {}
  snapCache.set(key, { raw, value });
  return value;
}
export function useLocalValue(key, fallback) {
  const value = useSyncExternalStore(
    (l) => {
      const on = (e) => {
        if (!e.detail || e.detail === key) l();
      };
      window.addEventListener(EVENT, on);
      window.addEventListener("storage", l);
      return () => {
        window.removeEventListener(EVENT, on);
        window.removeEventListener("storage", l);
      };
    },
    () => snapshot(key, fallback),
    () => fallback,
  );
  return [value, (v) => writeKey(key, v)];
}

// Уведомления внутри приложения (всплывающие сообщения).
export function notify(text, kind = "info") {
  window.dispatchEvent(new CustomEvent("picpac-toast", { detail: { text, kind } }));
  const list = readKey("notifications", []);
  list.unshift({ id: Date.now() + Math.random(), text, at: Date.now(), read: false });
  writeKey("notifications", list.slice(0, 50));
}
