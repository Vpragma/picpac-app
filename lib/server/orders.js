import "server-only";
// Заказы: чтение и форма ответа. Читаем от имени пользователя (RLS) и с фильтром по владельцу.
import { PRODUCTION_STEPS, progressFor } from "../erp";

export const STATUS_LABELS = {
  accepted: "Принят",
  moderation: "Модерация",
  production: "Производство",
  shipped: "Готов / передан в доставку",
  done: "Завершён",
};
export const STATUSES = Object.keys(STATUS_LABELS);

export const ORDER_FIELDS =
  "id, number, user_id, recipient, delivery_code, delivery_address, currency, goods_kop, discount_kop, delivery_kop, total_kop, promo_code, payment_method, payment_status, paid_at, status, substatus, status_changed_at, eta_from, eta_to, is_demo, created_at, updated_at, erp_stage, stage_changed_at";

const NUMBER_RE = /^PP-\d{6}-\d{4,6}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function orderKey(value) {
  if (UUID_RE.test(value)) return { col: "id", value };
  const n = String(value || "").toUpperCase();
  if (NUMBER_RE.test(n)) return { col: "number", value: n };
  return null;
}

export async function getOwnOrder(ctx, idOrNumber, fields = ORDER_FIELDS) {
  const key = orderKey(idOrNumber);
  if (!key) return null;
  const { data, error } = await ctx.db.from("orders").select(fields).eq(key.col, key.value).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export function shapeOrder(o, { items, history, interactions } = {}) {
  const out = {
    id: o.id,
    number: o.number,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status] || o.status,
    substatus: o.substatus,
    stage: o.erp_stage ?? null,
    progress: progressFor(o.status, o.erp_stage),
    statusChangedAt: o.status_changed_at,
    createdAt: o.created_at,
    currency: o.currency,
    goodsKop: o.goods_kop,
    discountKop: o.discount_kop,
    deliveryKop: o.delivery_kop,
    totalKop: o.total_kop,
    total: o.total_kop / 100,
    promoCode: o.promo_code,
    delivery: { code: o.delivery_code, address: o.delivery_address },
    recipient: o.recipient,
    payment: { method: o.payment_method, status: o.payment_status, paidAt: o.paid_at, test: true },
    eta: { from: o.eta_from, to: o.eta_to },
    isDemo: o.is_demo,
  };
  if (items) {
    out.items = items.map((i) => ({
      id: i.id,
      projectId: i.project_id,
      productSlug: i.product_slug,
      title: i.title,
      options: i.options,
      quantity: i.quantity,
      unitPriceKop: i.unit_price_kop,
      lineTotalKop: i.line_total_kop,
      snapshot: i.snapshot,
    }));
  }
  if (history) {
    out.timeline = STATUSES.map((s) => {
      const hit = history.filter((h) => h.status === s);
      return { status: s, label: STATUS_LABELS[s], at: hit[0]?.at || null, done: hit.length > 0 };
    });
    // Причину ручной смены видит только сотрудник; клиенту — нейтральный текст
    out.history = history.map((h) => ({
      status: h.status,
      label: STATUS_LABELS[h.status],
      substatus: h.substatus,
      at: h.at,
      source: h.source,
      event: h.event_type || null,
      reason: h.event_type === "manual_status" ? "Статус изменил оператор PicPac" : h.reason,
    }));
    // Подэтапы «Производства» (из событий ERP) для ленты
    const book = (items || []).some((i) => i.snapshot?.kind === "book");
    out.substeps = PRODUCTION_STEPS.filter((st) => !st.bookOnly || book || history.some((h) => h.event_type === st.stage)).map((st) => {
      const hit = history.filter((h) => h.event_type === st.stage).pop();
      return { stage: st.stage, label: st.label, at: hit?.at || null, done: !!hit || (o.status !== "production" && ["shipped", "done"].includes(o.status)) };
    });
  }
  if (interactions) out.interactions = interactions.map(shapeInteraction);
  return out;
}

export function shapeInteraction(i) {
  return { id: i.id, orderId: i.order_id, topic: i.topic, kind: i.kind, status: i.status, slaDue: i.sla_due, firstResponseAt: i.first_response_at || null, createdAt: i.created_at, updatedAt: i.updated_at };
}

export async function loadOrderFull(ctx, order) {
  const [items, history, interactions] = await Promise.all([
    ctx.db.from("order_items").select("*").eq("order_id", order.id),
    ctx.db.from("order_status_history").select("*").eq("order_id", order.id).order("at"),
    ctx.db.from("interactions").select("*").eq("order_id", order.id).eq("user_id", ctx.userId).order("created_at"),
  ]);
  // Пока читали ленту, симулятор мог сделать шаг (параллельный запрос): тогда перечитать заказ, чтобы статус и лента совпали
  const last = (history.data || []).at(-1);
  if (last && last.status !== order.status) {
    const { data: fresh } = await ctx.db.from("orders").select(ORDER_FIELDS).eq("id", order.id).maybeSingle();
    if (fresh) order = fresh;
  }
  return shapeOrder(order, { items: items.data || [], history: history.data || [], interactions: interactions.data || [] });
}
