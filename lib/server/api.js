import "server-only";
// Общие помощники для /api/v1: проверка входа и роли, разбор и проверка ввода (zod),
// лимиты частоты, журнал. Единый формат ошибки: { ok: false, error: { code, message, requestId } }.
import { z } from "zod";
import { clientIp, writeAudit } from "./audit";
import { jsonError, readJson, sameOrigin } from "./http";
import { requireApiRole } from "./session";
import { createSupabaseAdmin } from "./supabaseAdmin";

// Сообщения zod по-русски там, где мы не написали свои
z.config(z.locales.ru());
export { z };

export const BUCKET = "photos";
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
export const PHOTO_MIMES = ["image/jpeg", "image/png"];

export const uuid = z.string().uuid("Неверный идентификатор.");

// Контекст запроса вошедшего пользователя с нужной ролью: { ctx } или { response } (401/403)
export async function requireUser(request, roles = ["client"]) {
  const { auth, response } = await requireApiRole(request, roles);
  if (response) return { response };
  const ctx = {
    auth,
    userId: auth.user.id,
    email: auth.user.email,
    role: auth.activeRole,
    ip: clientIp(request.headers),
    // От имени пользователя: чтение под правилами RLS
    db: auth.supabase,
    // С секретным ключом: запись после проверок сервера
    admin: createSupabaseAdmin(),
  };
  ctx.audit = (action, objectType, objectId, result, details = {}) =>
    writeAudit({ userId: ctx.userId, role: ctx.role, action, objectType, objectId, result, email: ctx.email, details, ip: ctx.ip });
  return { ctx };
}

// Изменяющий запрос: проверка источника, JSON и схемы. { body } или { response } (400/403)
export async function parseBody(request, schema) {
  if (!sameOrigin(request)) return { response: jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.") };
  const raw = await readJson(request);
  if (!raw) return { response: jsonError(400, "bad_request", "Не получилось прочитать данные запроса. Обновите страницу и попробуйте ещё раз.") };
  const r = schema.safeParse(raw);
  if (!r.success) return { response: validationError(r.error) };
  return { body: r.data };
}

export function validationError(error) {
  const fields = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  const [key, message] = Object.entries(fields)[0] || ["_", "Проверьте данные."];
  const text = key === "_" ? message : `Проверьте поле «${key}»: ${message}`;
  return jsonError(400, "invalid_input", text, { fields });
}

// Проверка параметра пути (id): 404, если формат неверный — так не подсказываем, что бывает
export function badId(value) {
  return !uuid.safeParse(value).success;
}

export const notFound = (what = "Объект") => jsonError(404, "not_found", `${what} не найден. Возможно, его удалили или ссылка неверная.`);

// Лимит частоты через функцию в базе. true — лимит превышен.
export async function rateLimited(key, limit, windowSeconds) {
  try {
    const { data, error } = await createSupabaseAdmin().rpc("rate_limit_hit", { _key: key, _limit: limit, _window_seconds: windowSeconds });
    if (error) {
      console.error("Лимит частоты: ошибка базы", error.message);
      return false;
    }
    return data === false;
  } catch (e) {
    console.error("Лимит частоты:", e?.message);
    return false;
  }
}

export function tooMany(seconds = 60) {
  const res = jsonError(429, "rate_limited", "Слишком много запросов подряд. Подождите минуту и попробуйте снова.");
  res.headers.set("Retry-After", String(seconds));
  return res;
}

export function serverError(code = "server_error", message = "Что-то пошло не так на сервере. Попробуйте ещё раз.") {
  return jsonError(500, code, message);
}

// Деньги в ответах: и копейки (точно), и рубли (для показа)
export function money(kop) {
  return { kop, byn: Math.round(kop) / 100, currency: "BYN" };
}
