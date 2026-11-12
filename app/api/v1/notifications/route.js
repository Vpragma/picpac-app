// GET /api/v1/notifications?limit=30 — центр уведомлений клиента: { items, unread }.
// Только свои строки (RLS + фильтр по владельцу). Перед чтением симулятор ERP продвигает мои демо-заказы.
import { requireUser, serverError } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { shapeNotification, tickMyOrders, unreadCount } from "@/lib/server/notifications";

export async function GET(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limit = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get("limit")) || 30));
  try {
    await tickMyOrders(ctx);
    const { data, error } = await ctx.db.from("notifications").select("*").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(limit);
    if (error) return serverError();
    return json({ ok: true, items: data.map(shapeNotification), unread: await unreadCount(ctx) });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}
