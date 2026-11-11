// /api/v1/me — мой аккаунт.
// GET — кто я (гостю: { authenticated: false }); PATCH { name } — сменить имя;
// DELETE { password } — удалить аккаунт навсегда: фото из хранилища, проекты, корзину, адреса, подписки;
// заказы обезличиваются и остаются для отчётности.
import { purgeBeforeAccountDelete } from "@/lib/server/account";
import { clientIp, deleteBlocked, writeAudit } from "@/lib/server/audit";
import { json, jsonError, readMutation } from "@/lib/server/http";
import { clearAuthCookies, getAuth } from "@/lib/server/session";
import { createSupabaseAdmin, createSupabaseStateless } from "@/lib/server/supabase";
import { normName } from "@/lib/validate";

export async function GET() {
  const auth = await getAuth();
  if (!auth.user) return json({ authenticated: false });
  const { data: profile } = await auth.supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  return json({
    authenticated: true,
    user: { id: auth.user.id, email: auth.user.email, name: profile?.full_name || "" },
    roles: auth.roles,
    activeRole: auth.activeRole,
    needsRole: !auth.activeRole && auth.roles.length > 1,
  });
}

export async function PATCH(request) {
  const { body, response } = await readMutation(request);
  if (response) return response;
  const auth = await getAuth();
  if (!auth.user) return jsonError(401, "unauthorized", "Нужно войти в аккаунт.");

  const name = normName(body.name);
  if (!name) return jsonError(400, "invalid_input", "Введите имя — от 1 до 100 символов.", { fields: { name: "Введите имя — от 1 до 100 символов." } });

  const base = { userId: auth.user.id, role: auth.activeRole, action: "profile.update", objectType: "profile", objectId: auth.user.id, email: auth.user.email, ip: clientIp(request.headers) };
  // Пишет сервер (у пользователей нет прав на запись в базу), строго в свою строку
  const { error } = await createSupabaseAdmin().from("profiles").update({ full_name: name }).eq("id", auth.user.id);
  if (error) {
    await writeAudit({ ...base, result: "error", details: { field: "full_name" } });
    return jsonError(500, "save_failed", "Не получилось сохранить имя. Попробуйте ещё раз.");
  }
  await writeAudit({ ...base, result: "success", details: { field: "full_name" } });
  return json({ ok: true, name });
}

export async function DELETE(request) {
  const { body, response } = await readMutation(request);
  if (response) return response;
  const auth = await getAuth();
  if (!auth.user) return jsonError(401, "unauthorized", "Нужно войти в аккаунт.");

  const base = { userId: auth.user.id, role: auth.activeRole, action: "account.delete", objectType: "user", objectId: auth.user.id, email: auth.user.email, ip: clientIp(request.headers) };

  // Тестовые аккаунты общие для всех проверяющих — их не удаляем
  if (auth.user.isDemo) {
    await writeAudit({ ...base, result: "denied", details: { reason: "demo_account" } });
    return jsonError(403, "demo_account", "Тестовый аккаунт удалить нельзя: им пользуются другие проверяющие. Зарегистрируйте свой аккаунт, чтобы проверить удаление.");
  }
  if (await deleteBlocked({ userId: auth.user.id })) {
    await writeAudit({ ...base, result: "denied", details: { reason: "rate_limited" } });
    return jsonError(429, "rate_limited", "Слишком много попыток. Подождите 15 минут.");
  }

  // Подтверждение паролем: проверяем его отдельным подключением, не трогая текущую сессию
  const password = typeof body.password === "string" ? body.password : "";
  const check = createSupabaseStateless();
  const { error: wrong } = password ? await check.auth.signInWithPassword({ email: auth.user.email, password }) : { error: true };
  if (wrong) {
    await writeAudit({ ...base, result: "error", details: { reason: "wrong_password" } });
    return jsonError(400, "wrong_password", "Пароль не подходит. Аккаунт не удалён.", { fields: { password: "Пароль не подходит." } });
  }

  // Сначала файлы фото из хранилища и обезличивание заказов (заказы остаются для отчётности без личных данных).
  // Проекты, корзина, адреса, уведомления и подписки на пуши удалятся каскадом вместе с пользователем.
  let purged;
  try {
    purged = await purgeBeforeAccountDelete(createSupabaseAdmin(), auth.user.id);
  } catch (e) {
    console.error(e?.message);
    await writeAudit({ ...base, result: "error", details: { reason: "purge_failed" } });
    return jsonError(500, "delete_failed", "Не получилось удалить фото аккаунта. Аккаунт не удалён, попробуйте ещё раз.");
  }

  const { error } = await createSupabaseAdmin().auth.admin.deleteUser(auth.user.id);
  if (error) {
    await writeAudit({ ...base, result: "error", details: { reason: "delete_failed" } });
    return jsonError(500, "delete_failed", "Не получилось удалить аккаунт. Попробуйте ещё раз.");
  }
  // Профиль, роли, проекты и корзина удаляются вместе с пользователем, записи журнала остаются
  await writeAudit({ ...base, result: "success", details: { files: purged.files } });
  await clearAuthCookies();
  return json({ ok: true, redirect: "/", userId: auth.user.id });
}
