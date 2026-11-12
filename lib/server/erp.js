import "server-only";
// Вызов единой функции смены статуса в базе (public.erp_apply_event) и перевод её кодов в ответы HTTP.
import { EVENT_LABELS } from "../erp";
import { STATUS_LABELS } from "./orders";

const label = (s) => STATUS_LABELS[s] || s || "—";

export const ERP_ERRORS = {
  invalid_transition: { status: 409, message: (type, n, s) => `Событие «${EVENT_LABELS[type] || type}» недопустимо: заказ ${n} в статусе «${label(s)}».` },
  moderation_pending: { status: 409, message: (type, n) => `Заказ ${n} ждёт решения модератора — событие «${EVENT_LABELS[type] || type}» пока нельзя применить.` },
  idempotency_conflict: { status: 409, message: () => "Этот eventId уже использован для другого заказа или другого события." },
  order_not_found: { status: 404, message: () => "Заказ не найден." },
  same_status: { status: 409, message: (t, n, s) => `Заказ ${n} уже в статусе «${label(s)}».` },
  reason_required: { status: 400, message: () => "Укажите причину — от 5 символов." },
  invalid_status: { status: 400, message: () => "Выберите один из 5 статусов." },
  invalid_type: { status: 400, message: () => "Неизвестное событие." },
};

// { result, replayed, status, stage, code } или { error }
export async function applyEvent(admin, { eventId, orderId, type, at = null, source = "erp", actor = null, reason = null, payload = {} }) {
  const { data, error } = await admin.rpc("erp_apply_event", {
    _event_id: eventId,
    _order: orderId,
    _type: type,
    _at: at,
    _source: source,
    _actor: actor,
    _reason: reason,
    _payload: payload,
  });
  if (error) {
    console.error("erp_apply_event:", error.message);
    return { error };
  }
  return data || { error: { message: "empty" } };
}
