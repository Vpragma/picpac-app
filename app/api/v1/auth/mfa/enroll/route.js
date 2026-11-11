// POST /api/v1/auth/mfa/enroll — подключение приложения-аутентификатора (Supabase MFA, TOTP).
// Только для сотрудников и только когда двухфакторный вход включён флагом REQUIRE_STAFF_MFA.
// Ответ: { factorId, qr, secret } — QR-код и запасной ключ для ручного ввода. Мы их не храним.
import { isStaffRole } from "@/lib/roles";
import { clientIp, writeAudit } from "@/lib/server/audit";
import { staffMfaRequired } from "@/lib/server/env";
import { json, jsonError, readMutation } from "@/lib/server/http";
import { getAuth } from "@/lib/server/session";

export async function POST(request) {
  const { response } = await readMutation(request);
  if (response) return response;
  const auth = await getAuth();
  if (!auth.user) return jsonError(401, "unauthorized", "Сначала войдите в аккаунт.");

  const base = { userId: auth.user.id, role: auth.activeRole, action: "auth.mfa_enroll", objectType: "factor", email: auth.user.email, ip: clientIp(request.headers) };
  if (!staffMfaRequired()) return jsonError(400, "mfa_disabled", "Двухфакторный вход на этом стенде выключен — код не нужен.");
  if (!auth.roles.some(isStaffRole)) {
    await writeAudit({ ...base, result: "denied", details: { reason: "not_staff" } });
    return jsonError(403, "forbidden", "Код из приложения-аутентификатора нужен только сотрудникам.");
  }

  const mfa = auth.supabase.auth.mfa;
  const { data: factors, error: listError } = await mfa.listFactors();
  if (listError) return jsonError(503, "unavailable", "Не получилось связаться с сервисом входа. Попробуйте через минуту.");
  if (factors.totp.length) return jsonError(409, "already_enrolled", "Приложение-аутентификатор уже подключено — введите код из него.");

  // Незавершённые прошлые попытки подключения убираем, чтобы не копились
  for (const f of factors.all) {
    if (f.factor_type === "totp" && f.status !== "verified") await mfa.unenroll({ factorId: f.id });
  }

  const { data, error } = await mfa.enroll({ factorType: "totp", issuer: "PicPac", friendlyName: `PicPac ${new Date().toISOString().slice(0, 19)}` });
  if (error || !data?.totp?.qr_code) {
    await writeAudit({ ...base, result: "error", details: { reason: "enroll_failed", code: error?.code || null } });
    return jsonError(500, "enroll_failed", "Не получилось подготовить QR-код. Попробуйте ещё раз.");
  }
  await writeAudit({ ...base, objectId: data.id, result: "success", details: { step: "qr_shown" } });

  // Картинку QR-кода отдаём в base64: так она надёжно открывается в любом браузере
  const svg = data.totp.qr_code.replace(/^data:image\/svg\+xml;[^,]*,/, "");
  const qr = "data:image/svg+xml;base64," + Buffer.from(svg, "utf8").toString("base64");
  return json({ ok: true, factorId: data.id, qr, secret: data.totp.secret });
}
