// proxy.js (в Next.js 16 так называется бывший middleware) — работает до страниц и API.
// 1) Продлевает сессию Supabase, чтобы страницы видели свежий вход.
// 2) Первая линия защиты админки: /admin и /api/v1/admin/* без входа — 401, без роли — 403.
//    Вторая линия — проверка в самих страницах и обработчиках (lib/server/session.js).
import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import { API_ROUTES } from "./lib/apiRoutes";
import { isStaffRole, requiredRolesForPath, sortRoles } from "./lib/roles";
import { clientIp, shouldLogGuestDenial, writeAudit } from "./lib/server/audit";
import { buildCsp, newNonce } from "./lib/server/csp";
import { secureCookies, staffMfaRequired, supabasePublicKey, supabaseUrl } from "./lib/server/env";
import { effectiveRole, parseRoleCookie, ROLE_COOKIE } from "./lib/server/roleCookie";

const MESSAGES = {
  401: { code: "unauthorized", message: "Нужно войти в аккаунт." },
  403: { code: "forbidden", message: "Недостаточно прав для этого раздела." },
  mfa: {
    code: "mfa_required",
    message: "Нужен код из приложения-аутентификатора.",
  },
  503: {
    code: "unavailable",
    message: "Не получилось проверить права. Попробуйте через минуту.",
  },
};

// Единый формат ошибки API: { ok: false, error: { code, message, requestId } } + заголовок X-Request-Id
function apiError(status, error, headers = {}) {
  const requestId = crypto.randomUUID();
  const res = NextResponse.json({ ok: false, error: { ...error, requestId } }, { status, headers: { "Cache-Control": "private, no-store", ...headers } });
  res.headers.set("X-Request-Id", requestId);
  return res;
}

// Маршрут API для пути: из нескольких подходящих — самый конкретный (меньше [id]), как выбирает Next.js
export function matchApiRoute(path) {
  let best = null;
  for (const r of API_ROUTES) {
    if (!new RegExp(r.pattern).test(path)) continue;
    const wild = (r.pattern.match(/\[\^\/\]\+|\.\+/g) || []).length;
    if (!best || wild < best.wild) best = { ...r, wild };
  }
  return best;
}

// Страницы: новый nonce и CSP на каждый запрос. Next.js берёт nonce из заголовка запроса
// Content-Security-Policy и ставит его своим скриптам (app/layout.js делает страницы динамическими).
export async function proxy(request) {
  if (request.nextUrl.pathname.startsWith("/api/")) return handle(request);
  const nonce = newNonce();
  const csp = buildCsp(nonce, { dev: process.env.NODE_ENV === "development", https: secureCookies(), supabase: process.env.SUPABASE_URL || "" });
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  const res = await handle(request);
  res.headers.set("Content-Security-Policy", csp);
  return res;
}

async function handle(request) {
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/")) {
    // Неизвестный адрес API → JSON 404, неверный метод → JSON 405 (а не HTML-страница или пустой ответ)
    const route = matchApiRoute(path);
    if (!route)
      return apiError(404, {
        code: "not_found",
        message: "Такого адреса API нет.",
      });
    const allowed = [...route.methods, ...(route.methods.includes("GET") ? ["HEAD"] : []), "OPTIONS"];
    if (!allowed.includes(request.method))
      return apiError(
        405,
        {
          code: "method_not_allowed",
          message: `Метод ${request.method} здесь не поддерживается.`,
        },
        { Allow: allowed.join(", ") },
      );
  }
  // Вход, регистрация и выход сами ставят cookies — не мешаем им
  if (path.startsWith("/api/v1/auth/")) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl(), supabasePublicKey(), {
    cookieOptions: {
      httpOnly: true,
      secure: secureCookies(),
      sameSite: "lax",
      path: "/",
    },
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
    if (claims?.sub || shouldLogGuestDenial(ip))
      await writeAudit({
        userId: claims?.sub || null,
        role: ctx.role || null,
        action: "access.denied",
        objectType: "route",
        objectId: path,
        result: "denied",
        email: claims?.email,
        details: {
          status,
          reason,
          by: "proxy",
          claimed_role: ctx.claimed || null,
          roles: ctx.roles || [],
        },
        ip,
      });
    const out = isApi
      ? apiError(status, MESSAGES[reason === "mfa_required" ? "mfa" : status])
      : NextResponse.rewrite(new URL(`/denied/${status}`, request.url), { request });
    return withCookies(response, out);
  };

  if (!claims?.sub) return deny(401, "no_session");

  // Строго свои роли: админу правило RLS показывает роли всех пользователей
  const { data: rows, error } = await supabase.from("user_roles").select("role").eq("user_id", claims.sub);
  if (error) {
    const out = isApi ? apiError(503, MESSAGES[503]) : NextResponse.rewrite(new URL("/denied/403", request.url), { request });
    return withCookies(response, out);
  }
  const roles = sortRoles((rows || []).map((r) => r.role));
  const raw = request.cookies.get(ROLE_COOKIE)?.value || null;
  const claimed = parseRoleCookie(raw, claims.sub);
  const role = effectiveRole(claimed, roles);
  const ctx = {
    role,
    roles,
    claimed: raw ? claimed || raw.slice(0, 40) : null,
  };

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
