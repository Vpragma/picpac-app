import "server-only";
// Отправка пушей (Web Push, VAPID) — D5. В пуше нет персональных данных: заголовок, короткий текст, путь экрана.
// Адрес подписки — только известные push-сервисы (защита от SSRF): проверка и при сохранении, и при отправке.
// Мёртвые подписки (ответ 404/410) удаляются.
import { sendNotification } from "web-push"; // 4.0.0 — ESM без экспорта по умолчанию
import { PUSH_KINDS, seasonIcon } from "../notifyRules";
import { sendToSubscriptions, vapidPrivateKey } from "../pushSend";
import { readSeason } from "./season";
import { createSupabaseAdmin } from "./supabaseAdmin";

export { allowedEndpoint, deviceLabel } from "../notifyRules";

function vapid() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "").trim();
  const privateKey = vapidPrivateKey(process.env.VAPID_PRIVATE_KEY);
  const subject = (process.env.VAPID_SUBJECT || "").trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

// { sent, failed, removed, results } — пуш на все устройства пользователя. results: [{ service, ok, status }] —
// ответ push-сервиса по каждому устройству (201 — принято; 404/410 — подписка умерла и удалена). send — подмена для тестов
export async function pushToUser(userId, message, { ttl = 3600, urgency = "normal", topic, send = sendNotification, db = null } = {}) {
  const keys = vapid();
  if (!keys) return { sent: 0, failed: 0, removed: 0, results: [], skipped: "no_vapid" };
  const admin = db || createSupabaseAdmin();
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", userId).limit(10);
  // N2: иконка уведомления в цветах сезона (Android); без сезона — обычная
  const icon = message.icon || seasonIcon(await readSeason().catch(() => "none"));
  return sendToSubscriptions(admin, subs || [], { ...message, icon }, { keys, ttl, urgency, topic, send });
}


// Пуши по новым строкам центра уведомлений (их создают этапы D3/D4 и напоминания D5): только важные виды,
// только за последние сутки, ровно один раз (отметка pushed_at ставится до отправки).
// Вызывать после смены статуса (after(() => pushPendingNotifications())) и в расписании.
export async function pushPendingNotifications({ limit = 50, send } = {}) {
  const db = createSupabaseAdmin();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: rows, error } = await db
    .from("notifications")
    .select("id, user_id, kind, title, body, link")
    .is("pushed_at", null)
    .in("kind", PUSH_KINDS)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return { pushed: 0, error: "select" };
  let pushed = 0;
  for (const n of rows || []) {
    // Захват: только тот, кто поставил отметку, отправляет (параллельные запуски не задвоят)
    const { data: mine } = await db.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("id", n.id).is("pushed_at", null).select("id");
    if (!mine?.length) continue;
    const { data: s } = await db.from("notification_settings").select("push_enabled, order_updates").eq("user_id", n.user_id).maybeSingle();
    if (s && s.push_enabled === false) continue;
    if (n.kind !== "cart_reminder" && s && s.order_updates === false) continue;
    const r = await pushToUser(n.user_id, { title: "PicPac", body: n.title, url: n.link || "/", tag: n.kind.slice(0, 32) }, { db, ...(send ? { send } : {}) });
    pushed += r.sent;
  }
  return { pushed, checked: (rows || []).length };
}
