import "server-only";
// N9: пользователи и роли для администратора. Список и смена ролей идут через функции базы
// (миграция 0016_admin_n9): они сами проверяют, что вызывает админ, и не дают менять свои роли,
// снимать последнего администратора, трогать демо-аккаунты и синтетический набор жюри.
// Вызываем от имени вошедшего админа (auth.supabase) — функция видит его auth.uid().
import { z } from "zod";
import { maskEmail, maskName } from "../mask";
import { sortRoles } from "../roles";

export const userFilters = z.strictObject({
  q: z.string().trim().max(100, "Запрос — до 100 знаков.").optional(),
  role: z.enum(["client", "moderator", "admin"]).optional(),
  tests: z.enum(["0", "1"]).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional(),
});

export const PER_PAGE = 25;

export function userParams(params) {
  const out = {};
  for (const [k, v] of params instanceof URLSearchParams ? params.entries() : Object.entries(params || {})) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    out[k] = String(value).trim();
  }
  return out;
}

// Почта и имя — замаскированы (как у клиента в заказе, SEC-14). Найти человека можно по полной почте.
function shape(u, selfId) {
  return {
    id: u.id,
    email: maskEmail(u.email),
    name: maskName(u.full_name),
    roles: sortRoles(u.roles || []),
    createdAt: u.created_at,
    lastSignInAt: u.last_sign_in_at,
    isSynthetic: !!u.is_synthetic,
    isDemo: !!u.is_demo,
    isSelf: u.id === selfId,
  };
}

export async function listUsers(auth, f = {}) {
  const page = f.page || 1;
  const { data, error } = await auth.supabase.rpc("admin_list_users", {
    _q: f.q || null,
    _role: f.role || null,
    _hide_tests: f.tests !== "1",
    _limit: PER_PAGE,
    _offset: (page - 1) * PER_PAGE,
  });
  if (error) throw new Error("Пользователи не загрузились: " + error.message);
  const total = Number(data?.[0]?.total || 0);
  return { items: (data || []).map((u) => shape(u, auth.user.id)), total, page, per: PER_PAGE, pages: Math.max(1, Math.ceil(total / PER_PAGE)) };
}

// Ответ функции базы → HTTP
export const ROLE_RESULTS = {
  granted: { status: 200 },
  revoked: { status: 200 },
  unchanged: { status: 200 },
  forbidden: { status: 403, code: "forbidden", message: "Недостаточно прав для этого действия." },
  self: { status: 403, code: "self_role", message: "Свои роли менять нельзя — попросите другого администратора." },
  client_role: { status: 400, code: "client_role", message: "Роль «Клиент» есть у всех и не меняется." },
  not_found: { status: 404, code: "not_found", message: "Пользователь не найден. Возможно, аккаунт удалён." },
  demo_account: { status: 403, code: "demo_account", message: "Роли демо-аккаунтов фиксированы — их используют для показа." },
  synthetic: { status: 403, code: "synthetic", message: "Это синтетический аккаунт из набора для жюри — его не меняем." },
  last_admin: { status: 409, code: "last_admin", message: "Это последний администратор — снять роль нельзя." },
};

export async function setRole(auth, userId, role, grant) {
  const { data, error } = await auth.supabase.rpc("admin_set_role", { _user: userId, _role: role, _grant: grant });
  if (error) throw new Error("Роль не изменилась: " + error.message);
  return String(data || "forbidden");
}
