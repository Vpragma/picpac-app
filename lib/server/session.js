import "server-only";
// Кто сейчас вошёл и с какой ролью. Всё проверяется на сервере в каждом запросе:
// сессия — по подписи токена Supabase, роль — по таблице user_roles в базе.
import { cookies, headers } from "next/headers";
import { forbidden, redirect, unauthorized } from "next/navigation";
import { cache } from "react";
import { homeForRole, isStaffRole, requiredRolesForPath, sortRoles } from "../roles";
import { clientIp, writeAudit } from "./audit";
import { staffMfaRequired } from "./env";
import { jsonError } from "./http";
import { effectiveRole, parseRoleCookie, ROLE_COOKIE, roleCookieOptions } from "./roleCookie";
import { createSupabaseServer } from "./supabase";

export async function setActiveRole(userId, role) {
  const store = await cookies();
  store.set(ROLE_COOKIE, `${role}.${userId}`, roleCookieOptions(role));
}

export async function clearActiveRole() {
  const store = await cookies();
  store.delete(ROLE_COOKIE);
}

// Текущий пользователь: { user, roles, activeRole, ... }. user = null — гость.
export const getAuth = cache(async () => {
  const supabase = await createSupabaseServer();
  const guest = { supabase, user: null, roles: [], activeRole: null, claimedRole: null, mfaPending: false, aal: null };

  let claims = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims || null;
  } catch {
    claims = null;
  }
  if (!claims?.sub) return guest;

  // Роли читаем от имени пользователя: правило RLS отдаёт только его собственные строки
  const { data: rows, error } = await supabase.from("user_roles").select("role");
  if (error) throw new Error("Не удалось проверить роли: " + error.message);
  const roles = sortRoles((rows || []).map((r) => r.role));

  const store = await cookies();
  const raw = store.get(ROLE_COOKIE)?.value || null;
  const claimed = parseRoleCookie(raw, claims.sub);
  const role = effectiveRole(claimed, roles);

  const aal = claims.aal || "aal1";
  const mfaPending = !!role && isStaffRole(role) && staffMfaRequired() && aal !== "aal2";

  return {
    supabase,
    user: { id: claims.sub, email: claims.email || "", isDemo: claims.app_metadata?.demo === true },
    roles,
    activeRole: mfaPending ? null : role,
    // Что прислал браузер в cookie роли — для журнала, если это подделка
    claimedRole: raw ? claimed || raw.slice(0, 40) : null,
    pendingRole: mfaPending ? role : null,
    mfaPending,
    aal,
  };
});

// Адрес возврата подходит выбранной роли? Иначе — домашний раздел роли.
export function fitNext(next, role) {
  if (!next) return homeForRole(role);
  const need = requiredRolesForPath(next.split(/[?#]/)[0]);
  return need && !need.includes(role) ? homeForRole(role) : next;
}

// Сразу после входа или регистрации: одна роль — сразу в приложение,
// несколько — на экран выбора роли, роль сотрудника при включённом 2FA — на ввод кода.
export async function startSession({ userId, roles, aal, next }) {
  if (roles.length === 1) {
    const role = roles[0];
    if (isStaffRole(role) && staffMfaRequired() && aal !== "aal2") {
      await clearActiveRole();
      return { activeRole: null, redirect: `/login/mfa?role=${role}&next=${encodeURIComponent(fitNext(next, role))}` };
    }
    await setActiveRole(userId, role);
    return { activeRole: role, redirect: fitNext(next, role) };
  }
  await clearActiveRole();
  if (roles.length > 1) return { activeRole: null, redirect: "/login/role" + (next ? `?next=${encodeURIComponent(next)}` : "") };
  return { activeRole: null, redirect: next || "/" };
}

// Выход: убираем cookies сессии Supabase и выбранной роли
export async function clearAuthCookies() {
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name.startsWith("sb-")) store.delete(c.name);
  }
  store.delete(ROLE_COOKIE);
}

async function logDenied(auth, path, status, reason, ip) {
  await writeAudit({
    userId: auth.user?.id || null,
    role: auth.activeRole,
    action: "access.denied",
    objectType: "route",
    objectId: path,
    result: "denied",
    email: auth.user?.email,
    details: { status, reason, claimed_role: auth.claimedRole, roles: auth.roles },
    ip,
  });
}

// Для обработчиков API: { auth } или { response } с ошибкой 401/403
export async function requireApiRole(request, allowed) {
  const auth = await getAuth();
  const path = new URL(request.url).pathname;
  const ip = clientIp(request.headers);
  if (!auth.user) {
    await logDenied(auth, path, 401, "no_session", ip);
    return { response: jsonError(401, "unauthorized", "Нужно войти в аккаунт.") };
  }
  if (!auth.activeRole || !allowed.includes(auth.activeRole)) {
    const mfa = auth.mfaPending && allowed.includes(auth.pendingRole);
    await logDenied(auth, path, 403, mfa ? "mfa_required" : "no_role", ip);
    return mfa
      ? { response: jsonError(403, "mfa_required", "Нужен код из приложения-аутентификатора.") }
      : { response: jsonError(403, "forbidden", "Недостаточно прав для этого действия.") };
  }
  return { auth };
}

// Для страниц: пропускает дальше или показывает страницу 401/403 (app/unauthorized.js, app/forbidden.js)
export async function requirePageRole(allowed, path) {
  const auth = await getAuth();
  const ip = clientIp(await headers());
  if (!auth.user) {
    await logDenied(auth, path, 401, "no_session", ip);
    unauthorized();
  }
  if (auth.mfaPending && allowed.includes(auth.pendingRole)) {
    redirect(`/login/mfa?role=${auth.pendingRole}&next=${encodeURIComponent(path)}`);
  }
  if (!auth.activeRole || !allowed.includes(auth.activeRole)) {
    await logDenied(auth, path, 403, "no_role", ip);
    forbidden();
  }
  return auth;
}
