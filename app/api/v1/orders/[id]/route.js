// GET /api/v1/orders/{id} — мой заказ по id или номеру (PP-ГГММДД-NNNNN):
// состав, суммы, получатель, доставка, лента статусов, обращения. Чужой заказ — 404.
import { notFound, requireUser, serverError } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { getOwnOrder, loadOrderFull } from "@/lib/server/orders";

export async function GET(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  try {
    const order = await getOwnOrder(ctx, id);
    if (!order) {
      await ctx.audit("order.view", "order", String(id).slice(0, 60), "denied", { reason: "not_found_or_foreign" });
      return notFound("Заказ");
    }
    return json({ ok: true, order: await loadOrderFull(ctx, order) });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}
