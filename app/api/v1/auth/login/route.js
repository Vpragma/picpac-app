// POST /api/v1/auth/login — вход по почте и паролю.
// Тело: { email, password, next? }. Сессия ставится в httpOnly-cookies.
import { sortRoles } from "@/lib/roles";
import { clientIp, LOGIN_LIMIT, loginBlocked, writeAudit } from "@/lib/server/audit";
import { json, jsonError, readMutation } from "@/lib/server/http";
import { startSession } from "@/lib/server/session";
import { createSupabaseServer } from "@/lib/server/supabase";
import { normEmail, safeNext } from "@/lib/validate";

// Одна и та же фраза для любой ошибки входа — без подсказок, что именно не так
const WRONG = "Неверная почта или пароль.";

export async function POST(request) {
  const { body, response } = await readMutation(request);
  if (response) return response;

  const ip = clientIp(request.headers);
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const next = safeNext(body.next, "");

  if (!email || !password) {
    await writeAudit({ action: "auth.login", result: "error", email: email || undefined, details: { reason: "invalid_input" }, ip });
    return jsonError(401, "invalid_credentials", WRONG);
  }

  if (await loginBlocked({ email, ip })) {
    await writeAudit({ action: "auth.login", result: "denied", email, details: { reason: "rate_limited" }, ip });
    return jsonError(429, "rate_limited", `Слишком много неудачных попыток входа. Подождите ${LOGIN_LIMIT.minutes} минут и попробуйте снова.`);
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    const down = !error?.status || error.status >= 500;
    const limited = error?.status === 429;
    const reason = limited ? "service_rate_limit" : down ? "service_unavailable" : error.code || "invalid_credentials";
    await writeAudit({ action: "auth.login", result: "error", email, details: { reason }, ip });
    if (limited) return jsonError(429, "rate_limited", "Слишком много попыток входа. Подождите несколько минут.");
    if (down) return jsonError(503, "unavailable", "Сервис входа временно недоступен. Попробуйте через минуту.");
    return jsonError(401, "invalid_credentials", WRONG);
  }

  const user = data.user;
  const { data: rows, error: rolesError } = await supabase.from("user_roles").select("role");
  if (rolesError) {
    await writeAudit({ userId: user.id, action: "auth.login", objectType: "user", objectId: user.id, result: "error", email, details: { reason: "roles_unavailable" }, ip });
    await supabase.auth.signOut({ scope: "local" });
    return jsonError(503, "unavailable", "Не получилось загрузить роли. Попробуйте через минуту.");
  }
  const roles = sortRoles((rows || []).map((r) => r.role));

  const { activeRole, redirect } = await startSession({ userId: user.id, roles, aal: "aal1", next });
  await writeAudit({ userId: user.id, role: activeRole, action: "auth.login", objectType: "user", objectId: user.id, result: "success", email, details: { roles }, ip });
  return json({ ok: true, redirect, roles, activeRole });
}
