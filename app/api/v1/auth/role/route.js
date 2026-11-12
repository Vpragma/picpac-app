// POST /api/v1/auth/role — выбор активной роли после входа.
// Тело: { role, next? }. Роль записывается в httpOnly-cookie, только если она есть у пользователя в базе.
import { isRole, isStaffRole } from "@/lib/roles";
import { clientIp, writeAudit } from "@/lib/server/audit";
import { staffMfaRequired } from "@/lib/server/env";
import { limitWrite } from "@/lib/server/api";
import { json, jsonError, readMutation } from "@/lib/server/http";
import { fitNext, getAuth, setActiveRole } from "@/lib/server/session";
import { safeNext } from "@/lib/validate";

export async function POST(request) {
  const { body, response } = await readMutation(request);
  if (response) return response;

  const auth = await getAuth();
  if (!auth.user) return jsonError(401, "unauthorized", "Сначала войдите в аккаунт.");
  const limited = await limitWrite("role", auth.user.id, 30, 60);
  if (limited) return limited;

  const ip = clientIp(request.headers);
  const role = typeof body.role === "string" ? body.role : "";
  const next = safeNext(body.next, "");
  const base = { userId: auth.user.id, action: "auth.role_select", objectType: "role", email: auth.user.email, ip };

  if (!isRole(role) || !auth.roles.includes(role)) {
    await writeAudit({ ...base, role: auth.activeRole, objectId: role.slice(0, 20), result: "denied", details: { reason: "role_not_assigned", roles: auth.roles } });
    return jsonError(403, "forbidden", "Эта роль вам недоступна.");
  }

  // Модератору и админу при включённом флаге сначала нужен код из приложения-аутентификатора
  if (isStaffRole(role) && staffMfaRequired() && auth.aal !== "aal2") {
    return json({ ok: true, step: "mfa", redirect: `/login/mfa?role=${role}&next=${encodeURIComponent(fitNext(next, role))}` });
  }

  await setActiveRole(auth.user.id, role);
  await writeAudit({ ...base, role, objectId: role, result: "success" });
  return json({ ok: true, activeRole: role, redirect: fitNext(next, role) });
}
