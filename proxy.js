// proxy.js (в Next.js 16 так называется бывший middleware) — работает до страниц и API.
// 1) Продлевает сессию Supabase, чтобы страницы видели свежий вход.
// 2) Первая линия защиты админки: /admin и /api/v1/admin/* без входа — 401, без роли — 403.
//    Вторая линия — проверка в самих страницах и обработчиках (lib/server/session.js).
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { isStaffRole, requiredRolesForPath, sortRoles } from "./lib/roles";
import { clientIp, writeAudit } from "./lib/server/audit";
import { secureCookies, staffMfaRequired, supabasePublicKey, supabaseUrl } from "./lib/server/env";
import { effectiveRole, parseRoleCookie, ROLE_COOKIE } from "./lib/server/roleCookie";

const MESSAGES = {
  401: { code: "unauthorized", message: "Нужно войти в аккаунт." },
  403: { code: "forbidden", message: "Недостаточно прав для этого раздела." },
  mfa: { code: "mfa_required", message: "Нужен код из приложения-аутентификатора." },
  503: { code: "unavailable", message: "Не получилось проверить права. Попробуйте через минуту." },
};

export async function proxy(request) {
  const path = request.nextUrl.pathname;
  // Вход, регистрация и выход сами ставят cookies — не мешаем им
  if (path.startsWith("/api/v1/auth/")) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabasePublicKey(), {
    cookieOptions: { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list, headers) => {
        // Обновлённые токены нужны и странице в этом же запросе, и браузеру в ответе
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers || {})) response.headers.set(key, value);
      },
    },
  });

  let claims = null;
  try {
    const { data } = await supabase.auth.getClaims();
    claims = data?.claims || null;
  } catch {
    claims = null;
  }

  const need = requiredRolesForPath(path);
  if (!need) return response;

  const isApi = path.startsWith("/api/");
  const ip = clientIp(request.headers);

  // Отказ: запись в журнал и ответ 401/403 (для страниц — понятная страница на русском)
  const deny = async (status, reason, ctx = {}) => {
    await writeAudit({
      userId: claims?.sub || null,
      role: ctx.role || null,
      action: "access.denied",
      objectType: "route",
      objectId: path,
      result: "denied",
      email: claims?.email,
      details: { status, reason, by: "proxy", claimed_role: ctx.claimed || null, roles: ctx.roles || [] },
      ip,
    });
    const out = isApi
      ? NextResponse.json({ ok: false, error: MESSAGES[reason === "mfa_required" ? "mfa" : status] }, { status })
      : NextResponse.rewrite(new URL(`/denied/${status}`, request.url));
    return withCookies(response, out);
  };

  if (!claims?.sub) return deny(401, "no_session");

  const { data: rows, error } = await supabase.from("user_roles").select("role");
  if (error) {
    const out = isApi ? NextResponse.json({ ok: false, error: MESSAGES[503] }, { status: 503 }) : NextResponse.rewrite(new URL("/denied/403", request.url));
    return withCookies(response, out);
  }
  const roles = sortRoles((rows || []).map((r) => r.role));
  const raw = request.cookies.get(ROLE_COOKIE)?.value || null;
  const claimed = parseRoleCookie(raw, claims.sub);
  const role = effectiveRole(claimed, roles);
  const ctx = { role, roles, claimed: raw ? claimed || raw.slice(0, 40) : null };

  // Роль сотрудника без кода из приложения-аутентификатора (если 2FA включён флагом)
  if (role && need.includes(role) && isStaffRole(role) && staffMfaRequired() && claims.aal !== "aal2") {
    if (isApi) return deny(403, "mfa_required", ctx);
    const url = new URL("/login/mfa", request.url);
    url.searchParams.set("role", role);
    url.searchParams.set("next", path);
    return withCookies(response, NextResponse.redirect(url));
  }

  if (!role || !need.includes(role)) return deny(403, "no_role", ctx);

  // Ответы админки личные — не кэшировать
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

// Переносим обновлённые cookies сессии в другой ответ
function withCookies(from, to) {
  for (const cookie of from.cookies.getAll()) to.cookies.set(cookie);
  to.headers.set("Cache-Control", "private, no-store");
  return to;
}

export const config = {
  matcher: [
    // Админка и все API — всегда (в том числе адреса с точкой)
    "/admin/:path*",
    "/api/:path*",
    // Остальные страницы — чтобы продлевать сессию; статику не трогаем
    "/((?!_next/static|_next/image|api/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
