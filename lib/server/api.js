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

// Поля запроса — по-русски, чтобы в тексте ошибки не было технических ключей
const FIELD_LABELS = {
  productSlug: "продукт",
  title: "название",
  options: "настройки проекта",
  size: "размер",
  pages: "число страниц",
  cover: "обложка",
  lamination: "ламинация",
  paper: "бумага",
  print: "печать",
  surface: "поверхность",
  settings: "настройки редактора",
  version: "версия проекта",
  status: "статус",
  mime: "тип файла",
  bytes: "размер файла",
  name: "имя",
  path: "путь к фото",
  order: "порядок фото",
  items: "позиции корзины",
  projectId: "проект",
  quantity: "количество",
  code: "код",
  subtotal: "сумма",
  delivery: "доставка",
  "delivery.code": "способ доставки",
  address: "адрес",
  city: "город",
  street: "улица",
  house: "дом",
  flat: "квартира",
  postcode: "индекс",
  pickup_point: "пункт выдачи",
  recipient: "получатель",
  "recipient.name": "имя получателя",
  phone: "телефон",
  email: "почта",
  promoCode: "промокод",
  paymentMethod: "способ оплаты",
  method: "способ оплаты",
  topic: "тема обращения",
  kind: "тип обращения",
  message: "сообщение",
  body: "сообщение",
  edits: "правки фото",
  quality: "качество фото",
  nsfw: "проверка фото",
};

function fieldLabel(path) {
  const keys = path.filter((p) => typeof p === "string");
  const index = path.find((p) => typeof p === "number");
  const base = FIELD_LABELS[keys.join(".")] || FIELD_LABELS[keys[keys.length - 1]] || "одно из полей";
  return index != null ? `${base} (№ ${index + 1})` : base;
}

const KIND = { string: "текст", number: "число", int: "целое число", array: "список", object: "данные", boolean: "да или нет" };

// Свои сообщения схем уже по-русски. Стандартные сообщения zod заменяем понятными (без английских названий типов).
function humanMessage(issue) {
  const m = issue.message || "";
  const standard = /^(Неверн|Слишком (маленькое|большое)|Нераспознан|Invalid|Too (small|big)|Unrecognized|Expected)/i.test(m);
  if (!standard) return m;
  switch (issue.code) {
    case "invalid_type":
      // «…получено undefined» — поле не прислали
      return /undefined/.test(m) ? "Обязательное поле." : `Нужно ${KIND[issue.expected] ? `указать ${KIND[issue.expected]}` : "другое значение"}.`;
    case "too_small":
      if (issue.origin === "string") return `Минимум символов: ${issue.minimum}.`;
      if (issue.origin === "array") return `Нужно хотя бы ${issue.minimum}.`;
      return `Не меньше ${issue.minimum}.`;
    case "too_big":
      if (issue.origin === "string") return `Максимум символов: ${issue.maximum}.`;
      if (issue.origin === "array") return `Не больше ${issue.maximum}.`;
      return `Не больше ${issue.maximum}.`;
    case "invalid_format":
      return issue.format === "uuid" ? "Неверный идентификатор." : issue.format === "email" ? "Почта в формате name@example.com." : "Неверный формат.";
    case "unrecognized_keys":
      return "В запросе есть лишние поля — уберите их.";
    case "invalid_value":
      return "Выберите один из предложенных вариантов.";
    default:
      return "Неверное значение.";
  }
}

export function validationError(error) {
  const fields = {};
  const texts = [];
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (fields[key]) continue;
    const message = humanMessage(issue);
    fields[key] = message;
    texts.push(key === "_" ? message : `${fieldLabel(issue.path)} — ${message}`);
  }
  const text = texts.length ? `Проверьте данные: ${texts[0]}` : "Проверьте данные.";
  return jsonError(400, "invalid_input", text, { fields });
}

// Проверка параметра пути (id): 404, если формат неверный — так не подсказываем, что бывает
export function badId(value) {
  return !uuid.safeParse(value).success;
}

// N7: род слова — «Фото не найдено», «Обращение не найдено», «Заказ не найден»
const NEUTER = /^(Фото|Обращение)(\s|$)/;
const FEMININE = /^(Книга|Корзина|Позиция|Запись)(\s|$)/;
export const notFound = (what = "Объект") => {
  const [found, it] = NEUTER.test(what) ? ["не найдено", "его"] : FEMININE.test(what) ? ["не найдена", "её"] : ["не найден", "его"];
  return jsonError(404, "not_found", `${what} ${found}. Возможно, ${it} удалили или ссылка неверная.`);
};

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

// S12 (SEC-06): лимит частоты на изменяющий маршрут. Ключ — вид действия и пользователь (или IP).
// Пределы с запасом: обычная работа (синхронизация, загрузка 100 фото) в них не упирается.
// Возвращает готовый ответ 429 с Retry-After или null.
export async function limitWrite(kind, who, limit, windowSeconds = 60) {
  if (!who) return null;
  return (await rateLimited(`w:${kind}:${who}`, limit, windowSeconds)) ? tooMany(windowSeconds) : null;
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
