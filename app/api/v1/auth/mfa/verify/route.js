// POST /api/v1/auth/mfa/verify — проверка 6-значного кода из приложения-аутентификатора.
// Тело: { code, role, factorId?, next? }. После верного кода сессия получает уровень aal2,
// и сервер включает выбранную роль сотрудника.
import { isStaffRole } from "@/lib/roles";
import { clientIp, mfaBlocked, writeAudit } from "@/lib/server/audit";
import { staffMfaRequired } from "@/lib/server/env";
import { json, jsonError, readMutation } from "@/lib/server/http";
import { fitNext, getAuth, setActiveRole } from "@/lib/server/session";
import { safeNext } from "@/lib/validate";

export async function POST(request) {
  const { body, response } = await readMutation(request);
  if (response) return response;
  const auth = await getAuth();
  if (!auth.user) return jsonError(401, "unauthorized", "Сначала войдите в аккаунт.");
  if (!staffMfaRequired()) return jsonError(400, "mfa_disabled", "Двухфакторный вход на этом стенде выключен — код не нужен.");

  const role = typeof body.role === "string" ? body.role : "";
  const next = safeNext(body.next, "");
  const code = String(body.code ?? "").replace(/\s+/g, "");
  const base = { userId: auth.user.id, role: auth.activeRole, action: "auth.mfa_verify", objectType: "factor", email: auth.user.email, ip: clientIp(request.headers) };

  if (!isStaffRole(role) || !auth.roles.includes(role)) {
    await writeAudit({ ...base, objectId: null, result: "denied", details: { reason: "role_not_assigned", role: role.slice(0, 20) } });
    return jsonError(403, "forbidden", "Эта роль вам недоступна.");
  }
  if (!/^\d{6}$/.test(code)) return jsonError(400, "invalid_code", "Введите 6 цифр из приложения-аутентификатора.");
  if (await mfaBlocked({ userId: auth.user.id })) {
    await writeAudit({ ...base, result: "denied", details: { reason: "rate_limited" } });
    return jsonError(429, "rate_limited", "Слишком много неверных кодов. Подождите 15 минут.");
  }

  const mfa = auth.supabase.auth.mfa;
  const { data: factors, error: listError } = await mfa.listFactors();
  if (listError) return jsonError(503, "unavailable", "Не получилось связаться с сервисом входа. Попробуйте через минуту.");
  // Обычно — подтверждённый код; при первом подключении — только что созданный
  const factor = body.factorId
    ? factors.all.find((f) => f.id === body.factorId && f.factor_type === "totp")
    : factors.totp[0];
  if (!factor) return jsonError(400, "no_factor", "Сначала подключите приложение-аутентификатор.");

  const { error } = await mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) {
    await writeAudit({ ...base, objectId: factor.id, result: "error", details: { reason: "invalid_code" } });
    return jsonError(400, "invalid_code", "Код не подошёл. Проверьте, что время на телефоне точное, и введите новый код.");
  }

  await setActiveRole(auth.user.id, role);
  await writeAudit({ ...base, role, objectId: factor.id, result: "success", details: { first_time: factor.status !== "verified" } });
  return json({ ok: true, activeRole: role, redirect: fitNext(next, role) });
}
