"use client";
// Простое хранилище на устройстве (localStorage) для корзины, заказов и уведомлений.
// Вход и роли здесь НЕ хранятся: их проверяет сервер (httpOnly-cookies + база).
import { useEffect, useState, useSyncExternalStore } from "react";

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

// Хук: значение из хранилища, обновляется при любом изменении.
export function useStored(key, fallback) {
  const [value, setValue] = useState(fallback);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const load = () => setValue(readKey(key, fallback));
    load();
    setReady(true);
    const onChange = (e) => {
      if (!e.detail || e.detail === key) load();
    };
    const onStorage = () => load();
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [value, (v) => writeKey(key, v), ready];
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
