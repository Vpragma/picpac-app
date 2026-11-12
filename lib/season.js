"use client";
// Сезон оформления в браузере (N2). Атрибут data-season на <html> ставит сервер (app/layout.js) — без мигания.
// Здесь: чтение для клиентских компонентов (useSeason) и сверка с сервером — при загрузке, при возврате на вкладку
// и раз в 30 секунд, пока вкладка открыта. Так смена сезона в админке доходит до всех открытых клиентов.
import { useSyncExternalStore } from "react";
import { parseSeason, SEASON_LABELS, SEASONS } from "./seasonShared";

export { parseSeason, SEASON_LABELS, SEASONS };

const listeners = new Set();
const POLL_MS = 30_000;
const MIN_GAP_MS = 4_000;
let lastCheck = 0;

export function getSeason() {
  return parseSeason(document.documentElement.dataset.season);
}

export function applySeason(value) {
  const s = parseSeason(value);
  if (s === getSeason()) return;
  document.documentElement.dataset.season = s;
  listeners.forEach((l) => l());
}

function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

// initial — значение с сервера, чтобы разметка совпала при гидратации
export function useSeason(initial = "none") {
  return useSyncExternalStore(subscribe, getSeason, () => parseSeason(initial));
}

// В редакторе сезон не показывается — там ни одного лишнего запроса (N3: работа с фото только на устройстве)
const quietPath = () => location.pathname.startsWith("/editor");

export async function refreshSeason(force = false) {
  if (quietPath()) return getSeason();
  if (!force && Date.now() - lastCheck < MIN_GAP_MS) return getSeason();
  lastCheck = Date.now();
  try {
    const res = await fetch("/api/v1/season", { cache: "no-store" });
    if (!res.ok) return getSeason();
    const data = await res.json();
    applySeason(data?.season);
  } catch {
    // Нет сети — остаётся то, что прислал сервер со страницей
  }
  return getSeason();
}

// Сверка с сервером. Возвращает функцию остановки.
export function startSeasonSync() {
  const onVisible = () => {
    if (document.visibilityState === "visible") refreshSeason();
  };
  refreshSeason(true);
  const timer = setInterval(onVisible, POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pageshow", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pageshow", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}
