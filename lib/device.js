"use client";
// Выход из аккаунта (M-01): сначала всё отправить в аккаунт, потом стереть устройство.
// Устройство: IndexedDB «picpac» (проекты, фото, ключ заказа, очередь удалений), localStorage picpac:*
// (гостевая корзина, форма оформления, адреса), кэш «кто вошёл», пуш-подписка.
import { callApi, goTo } from "./api";
import { wipeDeviceData } from "./draft";
import { resetMe } from "./me";
import { syncAll } from "./sync";

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
  await wipeDeviceData().catch((e) => console.error(e));
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith("picpac:")) window.localStorage.removeItem(k);
    }
  } catch {}
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.();
    const sub = await reg?.pushManager?.getSubscription?.();
    if (sub) await sub.unsubscribe();
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
