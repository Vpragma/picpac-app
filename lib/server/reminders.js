import "server-only";
// Напоминание о забытой корзине (W-10, D5). Одно на корзину: ключ — хеш состава, уникальная пара (user_id, cart_key)
// в public.cart_reminders. Сначала «захват» строки, потом отправка — параллельные запуски (расписание и кнопка) не задвоят.
// Тихие часы пользователя (по умолчанию 22:00–09:00, Минск): корзину не захватываем, её отправит первый запуск после 09:00.
import { createHash } from "node:crypto";
import { cartKeySource, cartReminderText, dueCarts } from "../notifyRules";
import { writeAudit } from "./audit";
import { loadCatalog } from "./catalog";
import { pushPendingNotifications } from "./push";
import { createSupabaseAdmin } from "./supabaseAdmin";

const BATCH = 50;

async function productNames() {
  try {
    const cat = await loadCatalog();
    return Object.fromEntries((cat?.products || []).map((p) => [p.slug, p.name]));
  } catch {
    return {};
  }
}

export async function runCartReminders({ source = "cron", actorId = null, now = new Date() } = {}) {
  const db = createSupabaseAdmin();
  const { data: setting } = await db.rpc("app_setting", { _key: "cart_reminder_after_minutes" });
  const afterMin = Number(setting) > 0 ? Number(setting) : 1440;

  const { data: rows, error } = await db
    .from("cart_items")
    .select("user_id, project_id, updated_at, projects(title, product_slug, status, updated_at)")
    .order("updated_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error("Не удалось прочитать корзины: " + error.message);
  const userIds = [...new Set((rows || []).map((r) => r.user_id))];
  const settings = new Map();
  if (userIds.length) {
    const { data: s } = await db.from("notification_settings").select("user_id, reminders, quiet_from, quiet_to, timezone").in("user_id", userIds);
    for (const x of s || []) settings.set(x.user_id, x);
  }
  const { ready, quiet } = dueCarts(rows || [], settings, { now, afterMin });
  const names = ready.length ? await productNames() : {};

  let created = 0;
  for (const u of ready.slice(0, BATCH)) {
    const key = createHash("sha256").update(cartKeySource(u.ids)).digest("hex").slice(0, 32);
    const { data: claim } = await db.from("cart_reminders").upsert({ user_id: u.userId, cart_key: key }, { onConflict: "user_id,cart_key", ignoreDuplicates: true }).select("id");
    if (!claim?.length) continue; // этой корзине уже напоминали
    const text = cartReminderText({ title: u.title, productName: names[u.product] || "" });
    const { error: insErr } = await db.from("notifications").insert({ user_id: u.userId, kind: "cart_reminder", title: text.inbox.title, body: text.inbox.body, link: "/cart" });
    if (insErr) continue;
    created++;
    await writeAudit({ userId: u.userId, action: "notify.cart_reminder", objectType: "cart", objectId: key, result: "success", details: { source } });
  }
  // Пуши — по новым строкам центра уведомлений (напоминания и важные статусы заказов), ровно один раз
  const { pushed = 0 } = await pushPendingNotifications().catch(() => ({ pushed: 0 }));
  const summary = { due: ready.length, created, pushed, quiet: quiet.length, afterMin, source };
  await writeAudit({ userId: actorId, role: actorId ? "admin" : null, action: source === "admin" ? "admin.cart_reminders_now" : "cron.cart_reminders", objectType: "cart", result: "success", details: summary });
  return summary;
}
