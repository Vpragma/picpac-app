"use client";
// Пуши на этом устройстве: поддержка, согласие, подписка, отписка (D5). Подключать только в профиле —
// в общий Shell не тащить (бюджет JS). Разрешение спрашиваем только по нажатию, никогда при загрузке.
import { callApi } from "./api";

const KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ""; // публичный ключ встраивается при сборке — это нормально

// "ok" | "denied" | "ios-install" | "unsupported"
export function pushSupport() {
  if (typeof window === "undefined") return "unsupported";
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return ios && !standalone ? "ios-install" : "unsupported";
  if (!KEY) return "unsupported";
  return Notification.permission === "denied" ? "denied" : "ok";
}

function keyBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(timeout = 8000) {
  // В next dev воркера нет (Pwa.js регистрирует его только в production) — не ждём вечно
  return Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), timeout))]);
}

// D9: подписка сделана с другим открытым ключом VAPID (ключи сменили) — она недействительна
function sameKey(sub) {
  try {
    const k = sub?.options?.applicationServerKey;
    if (!k || !KEY) return true; // браузер не сообщает ключ — считаем своим
    const a = new Uint8Array(k);
    const b = keyBytes(KEY);
    return a.length === b.length && a.every((x, i) => x === b[i]);
  } catch {
    return true;
  }
}

// Есть ли подписка у этого устройства. Подписка со старым ключом: отписываемся и, если разрешение уже дано,
// сразу подписываемся с текущим ключом (иначе — null, и профиль предложит включить заново)
export async function currentSubscription() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const sub = (await reg?.pushManager?.getSubscription?.()) || null;
    if (!sub || sameKey(sub)) return sub;
    await callApi("/api/v1/push/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
    if (Notification.permission !== "granted" || !KEY) return null;
    const fresh = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) });
    const r = await callApi("/api/v1/push/subscriptions", { method: "POST", body: fresh.toJSON() });
    return r.ok ? fresh : null;
  } catch {
    return null;
  }
}

// Вызывать прямо из onClick: Safari показывает запрос разрешения только в ответ на жест
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: permission };
  const reg = await registration();
  if (!reg) return { ok: false, reason: "no_sw" };
  let sub;
  try {
    sub = await reg.pushManager.getSubscription();
    if (sub && !sameKey(sub)) {
      await sub.unsubscribe().catch(() => {}); // старый ключ — переподписываемся
      sub = null;
    }
    sub = sub || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }));
  } catch {
    return { ok: false, reason: "subscribe" };
  }
  const r = await callApi("/api/v1/push/subscriptions", { method: "POST", body: sub.toJSON() });
  if (!r.ok) {
    await sub.unsubscribe().catch(() => {});
    return { ok: false, reason: "server", message: r.error?.message };
  }
  return { ok: true };
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return { ok: true };
  await callApi("/api/v1/push/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  return { ok: true };
}
