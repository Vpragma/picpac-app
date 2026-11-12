"use client";
// Выключатель «Улучшать автоматически» (по умолчанию включён). Хранится на устройстве; есть в редакторе и в профиле.
import { useSyncExternalStore } from "react";

const KEY = "picpac:autoEnhance";
const listeners = new Set();

export function getAutoEnhance() {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoEnhance(on) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // приватный режим — настройка действует до перезагрузки
  }
  listeners.forEach((l) => l());
}

function subscribe(l) {
  listeners.add(l);
  const onStorage = (e) => e.key === KEY && l();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener("storage", onStorage);
  };
}

export function useAutoEnhance() {
  return useSyncExternalStore(subscribe, getAutoEnhance, () => true);
}
