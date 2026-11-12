"use client";
// Тема оформления (N1): «светлая» — по умолчанию у всех, независимо от настройки телефона; «тёмная»; «как в системе».
// Хранится в cookie pp_theme на устройстве. Атрибут data-color-scheme на <html> ставит сервер (app/layout.js) —
// без мигания при загрузке и без встроенного скрипта (строгая CSP). Здесь — общие функции и переключение в браузере.
import { useSyncExternalStore } from "react";
import { THEME_COLORS, THEME_COOKIE, THEMES, THEME_LABELS, parseTheme } from "./themeShared";

export { THEME_COLORS, THEME_COOKIE, THEMES, THEME_LABELS, parseTheme };

const YEAR = 60 * 60 * 24 * 365;
const listeners = new Set();

export function getTheme() {
  return parseTheme(document.documentElement.dataset.colorScheme);
}

function applyTheme(theme) {
  document.documentElement.dataset.colorScheme = theme;
  // Строка состояния: для «как в системе» сервер отдал оба варианта с media — их не трогаем
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (theme !== "system") metas.forEach((m) => m.setAttribute("content", THEME_COLORS[theme]));
}

export function setTheme(theme) {
  const t = parseTheme(theme);
  applyTheme(t);
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${t}; Path=/; Max-Age=${YEAR}; SameSite=Lax${secure}`;
  listeners.forEach((l) => l());
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// initial — значение с сервера (из cookie), чтобы разметка совпала при гидратации
export function useTheme(initial = "light") {
  return useSyncExternalStore(subscribe, getTheme, () => initial);
}

// Страница могла прийти из кэша сервис-воркера со старым атрибутом — сверяем его с cookie
export function syncThemeFromCookie() {
  const m = document.cookie.match(/(?:^|;\s*)pp_theme=([a-z]+)/);
  const t = parseTheme(m?.[1]);
  if (t !== getTheme()) {
    applyTheme(t);
    listeners.forEach((l) => l());
  }
}
