import "server-only";
// Чтение журнала для админки. Запрос идёт от имени админа: правило RLS
// в базе ещё раз проверяет, что у него есть роль admin.
// SEC-15 (D7): фильтры — группа или действие, результат, пользователь, дата по Минску, объект, почта;
// «Показать ещё» — курсором по id (без пропусков и повторов).
import { z } from "zod";
import { OBJECT_LABELS } from "../auditLabels";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата — в виде ГГГГ-ММ-ДД.");

// Фильтры из адреса (GET) — строгая схема: лишний параметр → 400
export const auditFilters = z.strictObject({
  action: z
    .string()
    .max(64)
    .regex(/^[a-z_]+(\.[a-z_]+|\.\*)?$/, "Неверное действие.")
    .optional(),
  result: z.enum(["success", "denied", "error"]).optional(),
  role: z.enum(["client", "moderator", "admin"]).optional(),
  // 1 — скрыть записи автотестов: пользователи e2e-… и critic-… и запросы с 127.0.0.1 (экран журнала ставит по умолчанию)
  hideTests: z.enum(["0", "1"]).optional(),
  user: z
    .string()
    .regex(/^[0-9a-f]{8}(-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/i, "Пользователь — полный id или первые 8 знаков.")
    .optional(),
  objectType: z.enum(Object.keys(OBJECT_LABELS)).optional(),
  objectId: z.string().trim().min(1).max(200).optional(),
  from: day.optional(),
  to: day.optional(),
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// Почта — только в теле POST (в адресе она попала бы в журналы сервера и историю браузера)
export const auditEmailSearch = auditFilters.extend({
  email: z.string().trim().toLowerCase().email("Неверная почта.").max(254),
});

// Параметры адреса → объект для схемы: пустые поля формы не считаем фильтром
export function filtersFromParams(params) {
  const out = {};
  for (const [k, v] of params instanceof URLSearchParams ? params.entries() : Object.entries(params || {})) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    out[k] = String(value);
  }
  return out;
}

// Минск — UTC+3 круглый год: начало дня по Минску в ISO
const minskStart = (d) => `${d}T00:00:00+03:00`;
const nextDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};
// Подчёркивание в LIKE — любой символ: экранируем
const likeGroup = (prefix) => prefix.replace(/[\\%_]/g, (c) => "\\" + c) + ".%";

// { items, next }: next — id для «Показать ещё» или null
export async function queryAudit(supabase, f = {}) {
  const limit = f.limit || 50;
  let q = supabase.from("audit_log").select("id, at, user_id, role, action, object_type, object_id, result, details, ip");
  if (f.action) q = f.action.endsWith(".*") ? q.like("action", likeGroup(f.action.slice(0, -2))) : q.eq("action", f.action);
  if (f.result) q = q.eq("result", f.result);
  if (f.role) q = q.eq("role", f.role);
  if (f.hideTests === "1") {
    // Константы, без ввода пользователя. Пустая почта или пустой IP — не тест, такие записи оставляем
    // Одно условие: два вызова .or() в одном запросе не складываются — действовал бы только последний
    q = q.or("and(or(details->>email.is.null,and(details->>email.not.like.e2e-*,details->>email.not.like.critic-*)),or(ip.is.null,ip.neq.127.0.0.1))");
  }
  if (f.user) {
    const u = f.user.toLowerCase();
    q = u.length === 36 ? q.eq("user_id", u) : q.gte("user_id", `${u}-0000-0000-0000-000000000000`).lte("user_id", `${u}-ffff-ffff-ffff-ffffffffffff`);
  }
  if (f.objectType) q = q.eq("object_type", f.objectType);
  if (f.objectId) q = q.eq("object_id", f.objectId);
  if (f.email) q = q.eq("details->>email", f.email);
  if (f.from) q = q.gte("at", minskStart(f.from));
  if (f.to) q = q.lt("at", minskStart(nextDay(f.to)));
  if (f.before) q = q.lt("id", f.before);
  const { data, error } = await q.order("id", { ascending: false }).limit(limit + 1);
  if (error) throw new Error("Не удалось прочитать журнал: " + error.message);

  const rows = data.slice(0, limit);
  // Имена пользователей берём из профилей; у удалённых аккаунтов профиля уже нет
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    names = Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name]));
  }
  return {
    items: rows.map((r) => ({ ...r, user_name: r.user_id ? (names[r.user_id] ?? null) : null })),
    next: data.length > limit ? rows[rows.length - 1].id : null,
  };
}

// Как раньше: последние записи без фильтров (используют старые тесты и скрипты)
export async function loadAudit(supabase, limit = 100) {
  return (await queryAudit(supabase, { limit })).items;
}
