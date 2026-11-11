import "server-only";
// Журнал действий (ОТ-04): кто, когда, что сделал, с каким объектом, чем закончилось.
import { isIP } from "node:net";
import { createSupabaseAdmin } from "./supabaseAdmin";

// IP посетителя. На Vercel его кладёт в заголовок x-forwarded-for сама платформа.
export function clientIp(headers) {
  const forwarded = (headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip = forwarded || headers.get("x-real-ip") || "";
  return isIP(ip) ? ip : null;
}

// Запись в журнал. Ошибка записи не ломает основное действие, но попадает в логи сервера.
export async function writeAudit({ userId = null, role = null, action, objectType = null, objectId = null, result, email, details = {}, ip = null }) {
  const row = {
    user_id: userId,
    role,
    action,
    object_type: objectType,
    object_id: objectId == null ? null : String(objectId).slice(0, 200),
    result,
    details: email ? { email, ...details } : details,
    ip,
  };
  try {
    const { error } = await createSupabaseAdmin().from("audit_log").insert(row);
    if (error) console.error("Журнал: не удалось записать", action, error.message);
  } catch (e) {
    console.error("Журнал: не удалось записать", action, e?.message);
  }
}

// Сколько раз за последние minutes минут было действие с таким результатом
// для этого пользователя, почты или IP. Нужна для ограничения числа попыток.
async function countRecent({ action, results, minutes, userId, email, ip }) {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  let q = createSupabaseAdmin()
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", action)
    .in("result", results)
    .gte("at", since);
  if (userId) q = q.eq("user_id", userId);
  else if (email) q = q.eq("details->>email", email);
  else q = q.eq("ip", ip);
  const { count, error } = await q;
  if (error) {
    console.error("Журнал: не удалось посчитать попытки", error.message);
    return 0;
  }
  return count || 0;
}

export const LOGIN_LIMIT = { minutes: 15, perEmail: 10, perIp: 30 };

// true — неудачных попыток входа слишком много, пора подождать
export async function loginBlocked({ email, ip }) {
  const base = { action: "auth.login", results: ["error"], minutes: LOGIN_LIMIT.minutes };
  const [byEmail, byIp] = await Promise.all([
    email ? countRecent({ ...base, email }) : 0,
    ip ? countRecent({ ...base, ip }) : 0,
  ]);
  return byEmail >= LOGIN_LIMIT.perEmail || byIp >= LOGIN_LIMIT.perIp;
}

// true — с этого IP за час слишком много регистраций
export async function registerBlocked({ ip }) {
  if (!ip) return false;
  const n = await countRecent({ action: "auth.register", results: ["success", "error"], minutes: 60, ip });
  return n >= 20;
}

// true — пароль при удалении аккаунта ввели неверно слишком много раз (защита от перебора)
export async function deleteBlocked({ userId }) {
  const n = await countRecent({ action: "account.delete", results: ["error"], minutes: 15, userId });
  return n >= 5;
}

// true — слишком много неверных кодов 2FA подряд (защита от перебора 6 цифр)
export async function mfaBlocked({ userId }) {
  const n = await countRecent({ action: "auth.mfa_verify", results: ["error"], minutes: 15, userId });
  return n >= 5;
}
