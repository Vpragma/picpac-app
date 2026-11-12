// POST /api/v1/orders/{id}/pay-test { method: "card_test" | "erip_test" } — тестовая оплата.
// Деньги не списываются, данные карты не запрашиваются. Повторная оплата не меняет заказ.
import { notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { getOwnOrder, loadOrderFull } from "@/lib/server/orders";

const schema = z.strictObject({ method: z.enum(["card_test", "erip_test"], { error: "Выберите тестовую оплату: карта или ЕРИП." }) });

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  const order = await getOwnOrder(ctx, id);
  if (!order) {
    await ctx.audit("order.pay_test", "order", String(id).slice(0, 60), "denied", { reason: "not_found_or_foreign" });
    return notFound("Заказ");
  }
  if (order.payment_status === "paid_test") {
    return json({ ok: true, alreadyPaid: true, message: "Заказ уже оплачен (тест).", order: await loadOrderFull(ctx, order) });
  }
  const now = new Date().toISOString();
  const { error } = await ctx.admin
    .from("orders")
    .update({ payment_status: "paid_test", payment_method: body.method, paid_at: now, updated_at: now })
    .eq("id", order.id)
    .eq("user_id", ctx.userId)
    .eq("payment_status", "unpaid");
  if (error) {
    await ctx.audit("order.pay_test", "order", order.number, "error");
    return serverError();
  }
  await ctx.audit("order.pay_test", "order", order.number, "success", { method: body.method, total_kop: order.total_kop });
  const fresh = await getOwnOrder(ctx, order.id);
  return json({ ok: true, message: "Оплата прошла (тест). Деньги не списываются.", order: await loadOrderFull(ctx, fresh) });
}
