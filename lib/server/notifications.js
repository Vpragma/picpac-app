import "server-only";
// Центр уведомлений. Клиенту — только важное (заказ принят, готов и передан в доставку, завершён,
// ответ поддержки, нужно заменить фото). Сотрудникам — лента по всем заказам. Строки создают триггеры базы (0007).
import { advanceDemoOrders } from "./orderFlow";

export const shapeNotification = (n) => ({
  id: n.id,
  kind: n.kind,
  title: n.title,
  body: n.body,
  link: n.link || (n.order_id ? `/orders/${n.order_id}` : null),
  orderId: n.order_id,
  category: n.category,
  read: !!n.read_at,
  createdAt: n.created_at,
});

// Перед чтением ленты клиента продвинуть его демо-заказы: уведомления появятся без открытия заказа
export async function tickMyOrders(ctx) {
  const { data } = await ctx.db.from("orders").select("id, status, is_demo").eq("user_id", ctx.userId).eq("is_demo", true).neq("status", "done").limit(20);
  if (data?.length) await advanceDemoOrders(ctx, data);
}

export async function unreadCount(ctx) {
  const { count } = await ctx.db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).is("read_at", null);
  return count || 0;
}

export const shapeStaff = (n, seenAt) => ({
  id: n.id,
  kind: n.kind,
  audience: n.audience,
  title: n.title,
  body: n.body,
  link: n.link,
  orderId: n.order_id,
  createdAt: n.created_at,
  unread: !seenAt || n.created_at > seenAt,
});

// Лента сотрудника: админ — всё, модератор — только audience = moderator. Читаем сервисным ключом после проверки роли.
export async function staffFeed(ctx, limit = 50) {
  let q = ctx.admin.from("staff_notifications").select("*").order("created_at", { ascending: false }).limit(limit);
  if (ctx.role !== "admin") q = q.eq("audience", "moderator");
  const [{ data, error }, { data: seen }] = await Promise.all([q, ctx.admin.from("staff_notification_reads").select("seen_at").eq("user_id", ctx.userId).maybeSingle()]);
  if (error) throw new Error(error.message);
  const seenAt = seen?.seen_at || null;
  let c = ctx.admin.from("staff_notifications").select("id", { count: "exact", head: true });
  if (ctx.role !== "admin") c = c.eq("audience", "moderator");
  if (seenAt) c = c.gt("created_at", seenAt);
  const { count } = await c;
  return { items: (data || []).map((n) => shapeStaff(n, seenAt)), unread: count || 0, seenAt };
}
