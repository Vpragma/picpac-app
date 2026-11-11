// POST /api/v1/auth/register — регистрация клиента.
// Тело: { name, email, password, next? }. Письмо-подтверждение в прототипе не нужно:
// пользователь создаётся на сервере уже подтверждённым и сразу входит.
import { clientIp, registerBlocked, writeAudit } from "@/lib/server/audit";
import { json, jsonError, readMutation } from "@/lib/server/http";
import { startSession } from "@/lib/server/session";
import { createSupabaseAdmin, createSupabaseServer } from "@/lib/server/supabase";
import { normEmail, normName, passwordProblem, safeNext } from "@/lib/validate";

export async function POST(request) {
  const { body, response } = await readMutation(request);
  if (response) return response;

  const ip = clientIp(request.headers);
  const name = normName(body.name);
  const email = normEmail(body.email);
  const password = typeof body.password === "string" ? body.password : "";
  const next = safeNext(body.next, "");

  const fields = {};
  if (!name) fields.name = "Введите имя — до 100 символов.";
  if (!email) fields.email = "Проверьте почту, например anna@mail.by.";
  const weak = passwordProblem(password);
  if (weak) fields.password = weak;
  if (Object.keys(fields).length) return jsonError(400, "invalid_input", "Проверьте поля формы.", { fields });

  if (await registerBlocked({ ip })) {
    await writeAudit({ action: "auth.register", result: "denied", email, details: { reason: "rate_limited" }, ip });
    return jsonError(429, "rate_limited", "Слишком много регистраций с этого устройства. Попробуйте через час.");
  }

  const admin = createSupabaseAdmin();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !created?.user) {
    await writeAudit({ action: "auth.register", result: "error", email, details: { reason: error?.code || "create_failed" }, ip });
    if (error?.code === "weak_password") {
      return jsonError(400, "weak_password", "Пароль слишком простой.", { fields: { password: "Пароль слишком простой: добавьте буквы и цифры." } });
    }
    // Не говорим, занята ли почта: это подсказка для перебора чужих адресов
    return jsonError(400, "register_failed", "Не получилось зарегистрироваться. Если у вас уже есть аккаунт — войдите.");
  }

  const userId = created.user.id;
  await writeAudit({ userId, role: "client", action: "auth.register", objectType: "user", objectId: userId, result: "success", email, ip });

  // Сразу входим под новым аккаунтом
  const supabase = await createSupabaseServer();
  const { error: loginError } = await supabase.auth.signInWithPassword({ email, password });
  if (loginError) {
    await writeAudit({ userId, action: "auth.login", objectType: "user", objectId: userId, result: "error", email, details: { reason: "after_register" }, ip });
    return json({ ok: true, redirect: "/login" + (next ? `?next=${encodeURIComponent(next)}` : ""), message: "Аккаунт создан. Войдите с почтой и паролем." });
  }
  const { activeRole, redirect } = await startSession({ userId, roles: ["client"], aal: "aal1", next });
  return json({ ok: true, redirect, roles: ["client"], activeRole });
}
