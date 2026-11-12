// POST /api/v1/erp/events — мок ERP присылает событие производства (без входа, по секрету).
// Заголовок Authorization: Bearer <ERP_SECRET>; сравнение в постоянное время. Нет секрета на сервере — 503 (закрыто).
// Тело (строго): { eventId, type, orderNumber | orderId, occurredAt?, comment? }.
// Идемпотентность по eventId: повтор → 200 replayed; тот же id с другим заказом или типом → 409.
// Недопустимый переход → 409 invalid_transition, модерация не пройдена → 409 moderation_pending.
// Отказы (409) не сохраняются как события — только в журнале: событие, пришедшее раньше времени, можно повторить с тем же id.
import { parseBody, rateLimited, tooMany, z } from "@/lib/server/api";
import { clientIp, shouldLogGuestDenial, writeAudit } from "@/lib/server/audit";
import { erpSecret } from "@/lib/server/env";
import { applyEvent, ERP_ERRORS } from "@/lib/server/erp";
import { json, jsonError } from "@/lib/server/http";
import { bearer, safeEqual } from "@/lib/server/secret";
import { ERP_EVENTS, progressFor } from "@/lib/erp";
import { orderKey, STATUS_LABELS } from "@/lib/server/orders";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

const schema = z
  .strictObject({
    eventId: z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/, "eventId — 8–100 символов: буквы, цифры, - _ . :"),
    type: z.enum(ERP_EVENTS, { error: `type — одно из: ${ERP_EVENTS.join(", ")}.` }),
    orderNumber: z.string().regex(/^PP-\d{6}-\d{4,6}$/i, "orderNumber в формате PP-ГГММДД-NNNNN.").optional(),
    orderId: z.string().uuid("orderId — UUID заказа.").optional(),
    occurredAt: z.iso.datetime({ offset: true, error: "occurredAt — дата и время ISO 8601 с часовым поясом." }).optional(),
    comment: z.string().trim().max(200, "comment — до 200 символов.").optional(),
  })
  .refine((b) => !!b.orderNumber !== !!b.orderId, { message: "Укажите ровно одно: orderNumber или orderId.", path: ["orderNumber"] });

export async function POST(request) {
  const ip = clientIp(request.headers);
  const audit = (result, objectId, details) => writeAudit({ action: "erp.event", objectType: "order", objectId, result, details, ip });
  const expected = erpSecret();
  if (!expected) return jsonError(503, "erp_not_configured", "Приём событий ERP не настроен на сервере (нет ERP_SECRET).");
  if (await rateLimited("erp:all", 600, 60)) return tooMany();
  if (!safeEqual(bearer(request.headers), expected)) {
    if (await rateLimited(`erp:bad:${ip || "unknown"}`, 20, 60)) return tooMany();
    if (shouldLogGuestDenial(ip)) await audit("denied", null, { reason: "bad_secret" });
    return jsonError(401, "unauthorized", "Нужен заголовок Authorization: Bearer <секрет ERP>.");
  }
  const { body, response } = await parseBody(request, schema);
  if (response) return response;

  const admin = createSupabaseAdmin();
  const key = body.orderId ? { col: "id", value: body.orderId } : orderKey(body.orderNumber);
  const { data: order } = await admin.from("orders").select("id, number").eq(key.col, key.value).maybeSingle();
  if (!order) {
    await audit("denied", body.orderNumber || body.orderId, { reason: "not_found", type: body.type, eventId: body.eventId });
    return jsonError(404, "not_found", "Заказ не найден.");
  }
  const r = await applyEvent(admin, {
    eventId: body.eventId,
    orderId: order.id,
    type: body.type,
    at: body.occurredAt || null,
    source: "erp",
    reason: body.comment || null,
    payload: body.comment ? { comment: body.comment } : {},
  });
  if (r.error) {
    await audit("error", order.number, { type: body.type, eventId: body.eventId });
    return jsonError(500, "server_error", "Не получилось применить событие. Повторите с тем же eventId.");
  }
  if (r.result !== "applied") {
    const e = ERP_ERRORS[r.code] || ERP_ERRORS.invalid_transition;
    await audit("denied", order.number, { reason: r.code, type: body.type, eventId: body.eventId, status: r.status });
    return jsonError(e.status, r.code, e.message(body.type, order.number, r.status), { status: r.status || null });
  }
  await audit("success", order.number, { type: body.type, eventId: body.eventId, replayed: !!r.replayed });
  return json({ ok: true, applied: true, replayed: !!r.replayed, order: await orderState(admin, order.id) });
}

async function orderState(admin, id) {
  const { data: o } = await admin.from("orders").select("id, number, status, substatus, erp_stage").eq("id", id).maybeSingle();
  return o && { id: o.id, number: o.number, status: o.status, statusLabel: STATUS_LABELS[o.status], stage: o.erp_stage, substatus: o.substatus, progress: progressFor(o.status, o.erp_stage) };
}
