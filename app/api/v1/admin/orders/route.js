// GET /api/v1/admin/orders — список заказов для администратора (N9).
// ?q=номер&status=&product=&from=ГГГГ-ММ-ДД&to=&overdue=1&moderation=1&source=all|real|synthetic&sort=&page=&per=
// Только роль admin (proxy.js + здесь). Без персональных данных: номер, даты, сумма, статус, город, продукты.
import { orderFilters, orderParams, queryOrders } from "@/lib/server/adminOrders";
import { json, jsonError } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function GET(request) {
  const { response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  const parsed = orderFilters.safeParse(orderParams(new URL(request.url).searchParams));
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return jsonError(400, "bad_request", `Неверный фильтр заказов. ${first?.path?.length ? `«${first.path.join(".")}»: ` : ""}${first?.message || ""}`.trim());
  }
  try {
    return json({ ok: true, timezone: "Europe/Minsk", ...(await queryOrders(createSupabaseAdmin(), parsed.data)) });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "orders_unavailable", "Не получилось загрузить заказы. Попробуйте ещё раз.");
  }
}
