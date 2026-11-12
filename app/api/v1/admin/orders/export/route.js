// GET /api/v1/admin/orders/export — выгрузка списка заказов в CSV (N9). Те же фильтры, что у списка.
// Только роль admin. В файле нет персональных данных: номер, дата, продукт, сумма, статус, город.
// Каждая выгрузка — запись в журнал (admin.orders_export: сколько строк и с какими фильтрами).
import { exportOrders, orderFilters, orderParams, ordersCsv } from "@/lib/server/adminOrders";
import { clientIp, writeAudit } from "@/lib/server/audit";
import { loadCatalog } from "@/lib/server/catalog";
import { jsonError, sameOrigin } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function GET(request) {
  const { auth, response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  // Ссылку «Скачать» с чужого сайта не выполняем (браузер пришлёт его адрес в Referer)
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  const parsed = orderFilters.safeParse(orderParams(new URL(request.url).searchParams));
  if (!parsed.success) return jsonError(400, "bad_request", `Неверный фильтр заказов. ${parsed.error.issues[0]?.message || ""}`.trim());
  const f = { ...parsed.data };
  delete f.page;
  delete f.per;
  const audit = (result, details) =>
    writeAudit({ userId: auth.user.id, role: auth.activeRole, action: "admin.orders_export", objectType: "order", objectId: null, result, email: auth.user.email, details, ip: clientIp(request.headers) });
  try {
    const [rows, catalog] = await Promise.all([exportOrders(createSupabaseAdmin(), f), loadCatalog().catch(() => ({ products: [] }))]);
    const names = Object.fromEntries(catalog.products.map((p) => [p.slug, p.name]));
    await audit("success", { count: rows.length, filters: f });
    const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Minsk" }).slice(0, 16).replace(/[ :]/g, "-");
    return new Response(ordersCsv(rows, names), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="picpac-orders-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Rows": String(rows.length),
      },
    });
  } catch (e) {
    console.error(e?.message);
    await audit("error", { reason: "db_error", filters: f });
    return jsonError(500, "export_failed", "Не получилось выгрузить заказы. Попробуйте ещё раз.");
  }
}
