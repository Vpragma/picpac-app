// /api/v1/push/subscriptions — пуш-подписка ЭТОГО устройства (вошедший клиент или сотрудник).
// POST — тело PushSubscription.toJSON(); DELETE { endpoint } — удалить свою подписку.
// Адрес — только известные push-сервисы (защита от SSRF). Подписка привязана к пользователю и сессии входа:
// при выходе сервер удаляет подписки этой сессии. В базе — короткая метка устройства, без полного User-Agent.
import { limitWrite, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { allowedEndpoint, deviceLabel } from "@/lib/server/push";

const ROLES = ["client", "moderator", "admin"];
const b64url = (min, max) => z.string().regex(new RegExp(`^[A-Za-z0-9_-]{${min},${max}}={0,2}$`), "Неверный ключ подписки.");
const subSchema = z.strictObject({
  endpoint: z.string().url().max(1000).refine(allowedEndpoint, "Неизвестный сервис уведомлений."),
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({ p256dh: b64url(80, 100), auth: b64url(16, 30) }),
});
const delSchema = z.strictObject({ endpoint: z.string().url().max(1000) });

export async function POST(request) {
  const { ctx, response } = await requireUser(request, ROLES);
  if (response) return response;
  const limited = await limitWrite("push", ctx.userId, 20, 60);
  if (limited) return limited;
  const { body, response: bad } = await parseBody(request, subSchema);
  if (bad) return bad;
  const device = deviceLabel(request.headers.get("user-agent") || "");
  // Тот же адрес у другого пользователя (устройство передали) — переписываем на текущего
  const row = { user_id: ctx.userId, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth, session_id: ctx.auth.sessionId || null, device };
  const { error } = await ctx.admin.from("push_subscriptions").upsert(row, { onConflict: "endpoint" });
  if (error) return serverError();
  await ctx.admin.from("notification_settings").upsert({ user_id: ctx.userId, push_enabled: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  await ctx.audit("push.subscribe", "push", null, "success", { host: new URL(body.endpoint).hostname, device });
  return json({ ok: true });
}

export async function DELETE(request) {
  const { ctx, response } = await requireUser(request, ROLES);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, delSchema);
  if (bad) return bad;
  // Только своя подписка: чужой адрес не удаляется и не раскрывается
  const { data } = await ctx.admin.from("push_subscriptions").delete().eq("user_id", ctx.userId).eq("endpoint", body.endpoint).select("id");
  const { count } = await ctx.admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId);
  if (!count) await ctx.admin.from("notification_settings").upsert({ user_id: ctx.userId, push_enabled: false, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  await ctx.audit("push.unsubscribe", "push", null, "success", { host: hostOf(body.endpoint), removed: data?.length || 0 });
  return json({ ok: true, removed: data?.length || 0 });
}

function hostOf(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
}
