import "server-only";
// Серверные события воронки (заказ создан, тестовая оплата) и обезличивание пользователя.
import { createHash } from "node:crypto";
import { createSupabaseAdmin } from "./supabaseAdmin";

// Хеш пользователя с солью ANALYTICS_SALT: по нему нельзя узнать человека, но можно связать шаги воронки
export function userHash(userId) {
  const salt = process.env.ANALYTICS_SALT;
  if (!userId || !salt) return null;
  return createHash("sha256").update(salt + ":" + userId).digest("hex");
}

// Хеш IP для ключа лимита частоты (сам IP нигде не хранится)
export function ipKey(ip) {
  return createHash("sha256")
    .update((process.env.ANALYTICS_SALT || "") + ":ip:" + (ip || "unknown"))
    .digest("hex")
    .slice(0, 32);
}

// Пункт 23: тестовые аккаунты (e2e-…, critic-…) — их события не попадают в «Только реальные»
export const isTestEmail = (email) => /^(e2e|critic)-/i.test(String(email || ""));

// Записать серверное событие. Ошибка статистики не ломает заказ.
export async function trackServer(type, userId, props = {}, email = null) {
  try {
    const { error } = await createSupabaseAdmin().from("analytics_events").insert({ type, user_hash: userHash(userId), props, is_test: isTestEmail(email) });
    if (error) console.error("Статистика:", error.message);
  } catch (e) {
    console.error("Статистика:", e?.message);
  }
}
