// Обезличенные события воронки из браузера: копим и отправляем пачкой в POST /api/v1/events (свой сервер, без сторонних счётчиков).
// Сеанс — случайный id, новый каждый день (по Минску). Кто вошёл, сервер узнаёт сам и пишет только хеш с солью.
// Ни почты, ни имени, ни адреса в событиях нет.
import { useEffect } from "react";

const KEY = "picpac:asid";
const MAX_BATCH = 50;
let queue = [];
let timer = null;
let listening = false;

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Minsk" });
}

export function sessionId() {
  const day = today();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "null");
    if (saved?.day === day && /^[a-f0-9]{24}$/.test(saved.id)) return saved.id;
  } catch {
    /* хранилище недоступно — новый id */
  }
  const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    localStorage.setItem(KEY, JSON.stringify({ day, id }));
  } catch {
    /* без сохранения: id живёт до перезагрузки */
  }
  return id;
}

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

// Записать событие. type — из CLIENT_EVENTS, extra: { step, durationMs, props: { product, kind, count } }
export function track(type, extra = {}) {
  if (typeof window === "undefined") return;
  listen();
  const ev = { type };
  if (extra.step) ev.step = extra.step;
  if (Number.isFinite(extra.durationMs)) ev.durationMs = Math.max(0, Math.min(3_600_000, Math.round(extra.durationMs)));
  if (extra.props) ev.props = extra.props;
  queue.push(ev);
  if (queue.length >= 20) flush();
  else if (!timer) timer = setTimeout(flush, 4000);
}

export function flush() {
  clearTimeout(timer);
  timer = null;
  if (!queue.length || typeof window === "undefined") return;
  const events = queue.splice(0, MAX_BATCH);
  try {
    fetch("/api/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid: sessionId(), events }),
      keepalive: true,
      credentials: "same-origin",
    }).catch(() => {});
  } catch {
    /* статистика не должна мешать работе */
  }
  if (queue.length) timer = setTimeout(flush, 1000);
}

// Время на шаге редактора: считаем только пока вкладка видна. Пишем при уходе с шага или закрытии страницы.
export function useStepTimer(step, enabled = true) {
  useEffect(() => {
    if (!step || !enabled || typeof document === "undefined") return;
    let spent = 0;
    let since = document.visibilityState === "visible" ? performance.now() : null;
    const stop = () => {
      if (since != null) spent += performance.now() - since;
      since = null;
    };
    const emit = () => {
      stop();
      if (spent >= 500) track("editor_step", { step, durationMs: spent });
      spent = 0;
    };
    const onVis = () => {
      if (document.visibilityState === "visible") since = performance.now();
      else stop();
    };
    const onHide = () => {
      emit();
      flush();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      emit();
    };
  }, [step, enabled]);
}
