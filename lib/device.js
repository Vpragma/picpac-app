"use client";
// Выход из аккаунта (M-01): сначала всё отправить в аккаунт, потом стереть устройство.
// Устройство: IndexedDB «picpac» (проекты, фото, ключ заказа, очередь удалений), localStorage picpac:*
// (гостевая корзина, форма оформления, адреса), кэш «кто вошёл», пуш-подписка.
import { callApi, goTo } from "./api";
import { wipeDeviceData } from "./draft";
import { resetMe } from "./me";
import { stopSync, syncAll } from "./sync";

// true — всё на сервере; false — что-то не ушло (нет связи или ошибка)
export async function syncBeforeLogout() {
  try {
    return await syncAll();
  } catch (e) {
    console.error(e);
    return false;
  }
}

export async function wipeDevice() {
  stopSync(); // N7: после выхода — ни отправки, ни докачки фото (иначе 401 на адреса фото)
  await wipeDeviceData().catch((e) => console.error(e));
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("picpac:")) window.localStorage.removeItem(k);
    }
  } catch {}
  // Кэши сервис-воркера с данными пользователя (picpac-user-*). Сейчас ответы с данными пользователя не кэшируются
  // вовсе (public/sw.js), правило — на случай, если такие кэши появятся.
  try {
    for (const key of (await window.caches?.keys?.()) || []) if (key.startsWith("picpac-user-")) await window.caches.delete(key);
  } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const sub = await reg?.pushManager?.getSubscription?.();
    if (sub) {
      // Сначала отвязать на сервере (сессия ещё жива), потом на устройстве. Ошибки не мешают выходу
      await callApi("/api/v1/push/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch {}
  resetMe();
}

// Стереть устройство и закрыть сессию на сервере. { ok } или { ok: false, message }
export async function logoutAndWipe() {
  await wipeDevice();
  const res = await callApi("/api/v1/auth/logout");
  if (!res.ok) return { ok: false, message: res.error?.message || "Не получилось выйти. Попробуйте ещё раз." };
  goTo(res.redirect || "/");
  return { ok: true };
}
