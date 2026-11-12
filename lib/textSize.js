"use client";
// Режим «Крупный текст» (M-10, SL-5): атрибут data-text="lg" на <html> увеличивает всё в rem на 25 %.
// Хранится в cookie pp_text на устройстве — сервер (app/layout.js) ставит атрибут сам, без мигания при загрузке.
import { useSyncExternalStore } from "react";

const COOKIE = "pp_text";
const YEAR = 60 * 60 * 24 * 365;
const listeners = new Set();

export function getLargeText() {
  return document.documentElement.dataset.text === "lg";
}

export function setLargeText(on) {
  const el = document.documentElement;
  if (on) el.dataset.text = "lg";
  else delete el.dataset.text;
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${COOKIE}=${on ? "lg" : "off"}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
  listeners.forEach((l) => l());
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// initial — значение с сервера (из cookie), чтобы разметка совпала при гидратации
export function useLargeText(initial = false) {
  return useSyncExternalStore(subscribe, getLargeText, () => initial);
}

// Страница могла прийти из кэша сервис-воркера со старым атрибутом — сверяем его с cookie
export function syncLargeTextFromCookie() {
  const on = /(?:^|;\s*)pp_text=lg(?:;|$)/.test(document.cookie);
  if (on !== getLargeText()) {
    const el = document.documentElement;
    if (on) el.dataset.text = "lg";
    else delete el.dataset.text;
    listeners.forEach((l) => l());
  }
}
