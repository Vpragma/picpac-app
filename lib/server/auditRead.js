import "server-only";
// Чтение журнала для админки. Запрос идёт от имени админа: правило RLS
// в базе ещё раз проверяет, что у него есть роль admin.
// SEC-15 (D7): фильтры — группа или действие, результат, пользователь, дата по Минску, объект, почта;
// «Показать ещё» — курсором по id (без пропусков и повторов).
import { z } from "zod";
import { OBJECT_LABELS } from "../auditLabels";
import { ADMIN_ACTIONS, AUDIT_QUICK, ERP_PREFIX, SYSTEM_PREFIXES, pageGroups } from "../auditView";

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
  // 1 — скрыть записи автотестов: пользователи e2e-…, critic-…, night2-… и запросы с 127.0.0.1 (экран журнала ставит по умолчанию)
  hideTests: z.enum(["0", "1"]).optional(),
  // N9: 1 — скрыть системные события (расписание, автоматические уведомления) и события ERP (в том числе симулятора)
  hideSystem: z.enum(["0", "1"]).optional(),
  hideErp: z.enum(["0", "1"]).optional(),
  // N9: быстрый фильтр (входы, отказы, смены статуса, модерация, админские действия)
  quick: z.enum(Object.keys(AUDIT_QUICK)).optional(),
  // N9: последние N дней (1, 7, 30); all — без ограничения. Даты from/to точнее и важнее
  days: z.enum(["1", "7", "30", "all"]).optional(),
  // N9: 1 — сгруппировать одинаковые события подряд («×12»); ответ — groups вместо items
  group: z.enum(["0", "1"]).optional(),
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

// Условия «или» складываем в один вызов .or(): два вызова .or() в одном запросе не складываются —
// действовал бы только последний. Все части — константы, без ввода пользователя.
const ADMIN_OR = `or(action.like.admin.*,action.in.(${ADMIN_ACTIONS.join(",")}))`;

// Фильтры журнала → запрос PostgREST (без сортировки и лимита)
function applyFilters(q, f) {
  const ors = [];
  if (f.action) q = f.action.endsWith(".*") ? q.like("action", likeGroup(f.action.slice(0, -2))) : q.eq("action", f.action);
  if (f.result) q = q.eq("result", f.result);
  if (f.role) q = q.eq("role", f.role);
  // N9: быстрые фильтры. Входы и модерация — по началу действия (индекс audit_log_action_prefix_idx)
  if (f.quick === "logins") q = q.like("action", likeGroup("auth"));
  if (f.quick === "denied") q = q.in("result", ["denied", "error"]);
  if (f.quick === "status") q = q.eq("action", "order.status_change");
  if (f.quick === "moderation") q = q.like("action", likeGroup("moderation"));
  if (f.quick === "admin") ors.push(ADMIN_OR);
  // Автотесты: признак is_test считает база (представление audit_log_view, миграция 0016_admin_n9_audit):
  // почта e2e-/critic-/night2-, запрос с 127.0.0.1, пометка details.test, удалённый (тестовый) аккаунт
  if (f.hideTests === "1") q = q.eq("is_test", false);
  // N9: системные события и ERP — фильтры по одному столбцу складываются через «и»
  if (f.hideSystem === "1") for (const p of SYSTEM_PREFIXES) q = q.not("action", "like", likeGroup(p.slice(0, -1)));
  if (f.hideErp === "1") q = q.not("action", "like", likeGroup(ERP_PREFIX.slice(0, -1)));
  if (f.user) {
    const u = f.user.toLowerCase();
    q = u.length === 36 ? q.eq("user_id", u) : q.gte("user_id", `${u}-0000-0000-0000-000000000000`).lte("user_id", `${u}-ffff-ffff-ffff-ffffffffffff`);
  }
  // N7 E5: журнал заказа — и решения модератора по его фото: у них объект moderation_review, номер заказа — в details.order.
  // Номер подставляется в условие «или», поэтому только безопасные знаки (буквы, цифры, дефис); иначе — обычный фильтр.
  if (f.objectType === "order" && f.objectId && /^[A-Za-z0-9-]{1,64}$/.test(f.objectId))
    ors.push(`or(and(object_type.eq.order,object_id.eq.${f.objectId}),and(object_type.eq.moderation_review,details->>order.eq.${f.objectId}))`);
  else {
    if (f.objectType) q = q.eq("object_type", f.objectType);
    if (f.objectId) q = q.eq("object_id", f.objectId);
  }
  if (f.email) q = q.eq("details->>email", f.email);
  if (f.from) q = q.gte("at", minskStart(f.from));
  if (f.to) q = q.lt("at", minskStart(nextDay(f.to)));
  if (ors.length) q = q.or(ors.length === 1 ? ors[0] : `and(${ors.join(",")})`);
  if (f.days && f.days !== "all" && !f.from && !f.to) q = q.gte("at", new Date(Date.now() - Number(f.days) * 86_400_000).toISOString());
  return q;
}

// Имена пользователей берём из профилей; у удалённых аккаунтов профиля уже нет
async function withNames(supabase, rows) {
  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    names = Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name]));
  }
  return rows.map((r) => ({ ...r, user_name: r.user_id ? (names[r.user_id] ?? null) : null }));
}

const COLUMNS = "id, at, user_id, role, action, object_type, object_id, result, details, ip, is_test";
// Читаем через представление (те же строки + is_test). Сам журнал — только для чтения и добавления.
const SOURCE = "audit_log_view";

// N9: группы одинаковых событий подряд. Читаем окно до scan строк (по индексу id, с лимитом),
// группируем и отдаём pageSize групп. { groups: [{ count, items }], rows, next }
export async function queryAuditGroups(supabase, f = {}, { pageSize = 50, scan = 400 } = {}) {
  let q = applyFilters(supabase.from(SOURCE).select(COLUMNS), f);
  if (f.before) q = q.lt("id", f.before);
  const { data, error } = await q.order("id", { ascending: false }).limit(scan + 1);
  if (error) throw new Error("Не удалось прочитать журнал: " + error.message);
  const { groups, next } = pageGroups(data.slice(0, scan), { pageSize, moreRows: data.length > scan });
  const shown = groups.flatMap((g) => g.items);
  const named = await withNames(supabase, shown);
  let i = 0;
  return {
    groups: groups.map((g) => ({ count: g.items.length, items: g.items.map(() => named[i++]) })),
    rows: shown.length,
    next,
  };
}

// { items, next }: next — id для «Показать ещё» или null
export async function queryAudit(supabase, f = {}) {
  const limit = f.limit || 50;
  let q = applyFilters(supabase.from(SOURCE).select(COLUMNS), f);
  if (f.before) q = q.lt("id", f.before);
  const { data, error } = await q.order("id", { ascending: false }).limit(limit + 1);
  if (error) throw new Error("Не удалось прочитать журнал: " + error.message);

  const rows = data.slice(0, limit);
  return {
    items: await withNames(supabase, rows),
    next: data.length > limit ? rows[rows.length - 1].id : null,
  };
}

// Как раньше: последние записи без фильтров (используют старые тесты и скрипты)
export async function loadAudit(supabase, limit = 100) {
  return (await queryAudit(supabase, { limit })).items;
}
