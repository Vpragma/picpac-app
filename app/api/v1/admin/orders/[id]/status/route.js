// POST /api/v1/admin/orders/{id}/status { status, reason } — ручная смена статуса администратором.
// Причина обязательна (от 5 символов). Смена идёт через ту же функцию, что события ERP (public.erp_apply_event):
// в ленте — источник «admin», автор и причина; в журнале — order.status_change {from, to, reason}.
// Клиент видит новый статус и нейтральный текст «Статус изменил оператор PicPac».
import { randomUUID } from "node:crypto";
import { badId, limitWrite, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { applyEvent, ERP_ERRORS } from "@/lib/server/erp";
import { json, jsonError } from "@/lib/server/http";
import { STATUS_LABELS, STATUSES } from "@/lib/server/orders";

const schema = z.strictObject({
  status: z.enum(STATUSES, { error: "Выберите один из 5 статусов." }),
  reason: z.string().trim().min(5, "Укажите причину — от 5 символов.").max(300, "Причина — до 300 символов."),
});

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) {
    await ctx.audit("order.status_change", "order", String(id).slice(0, 60), "denied", { reason: "invalid_input" });
    return bad;
  }
  const limited = await limitWrite("order-status", ctx.userId, 60);
  if (limited) return limited;
  if (badId(id)) return notFound("Заказ");
  const { data: order } = await ctx.admin.from("orders").select("id, number, status, is_synthetic").eq("id", id).maybeSingle();
  if (!order) return notFound("Заказ");

  const r = await applyEvent(ctx.admin, {
    eventId: `admin:${randomUUID()}`,
    orderId: order.id,
    type: "manual_status",
    at: null,
    source: "admin",
    actor: ctx.userId,
    reason: body.reason,
    payload: { status: body.status },
  });
  if (r.error) return serverError();
  if (r.result !== "applied") {
    const e = ERP_ERRORS[r.code] || ERP_ERRORS.invalid_transition;
    await ctx.audit("order.status_change", "order", order.number, "denied", { reason: r.code, to: body.status });
    const extra = r.code === "reason_required" ? { fields: { reason: e.message() } } : {};
    return jsonError(e.status, r.code, e.message("manual_status", order.number, r.status), extra);
  }
  await ctx.audit("order.status_change", "order", order.number, "success", { from: order.status, to: body.status, reason: body.reason });
  return json({ ok: true, order: { id: order.id, number: order.number, status: r.status, statusLabel: STATUS_LABELS[r.status], substatus: r.substatus } });
}
