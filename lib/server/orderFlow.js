import "server-only";
// Минимальное продвижение статусов демо-заказов (полный мок ERP с событиями — этап S06).
// Статусы двигаются при чтении заказа (GET /orders, GET /orders/{id}) по таймеру от последней смены:
//   «Принят» → после тестовой оплаты «Модерация»;
//   «Модерация» → «Производство» автоодобрением, если ни у одного фото нет флага (с флагом ждёт модератора);
//   «Производство» → «Готов / передан в доставку» → «Завершён».
// Смена статуса — условное обновление (status = текущий), поэтому два одновременных чтения не задвоят ленту.
import { STATUSES } from "./orders";

export const DEMO_STEP_SECONDS = 30;

const REASONS = {
  moderation: "Оплата получена (тест): заказ ушёл на проверку макета",
  production: "Автоодобрение: у фото нет флагов модерации",
  shipped: "Напечатан, собран и упакован",
  done: "Доставлен (демо)",
};

function flagged(items) {
  return (items || []).some((i) => (i.snapshot?.photos || []).some((p) => p.moderationFlag));
}

// Следующий шаг для заказа или null. items нужны только для проверки флагов модерации.
function nextStep(o, items) {
  if (!o.is_demo) return null;
  const i = STATUSES.indexOf(o.status);
  const next = STATUSES[i + 1];
  if (!next) return null;
  if (o.status === "accepted" && o.payment_status !== "paid_test") return null;
  if (o.status === "moderation" && flagged(items)) return null;
  return next;
}

// Продвинуть заказы, у которых подошло время. Возвращает true, если что-то изменилось (тогда заказ перечитать).
export async function advanceDemoOrders(ctx, orders, itemsByOrder = {}) {
  let changed = false;
  const now = Date.now();
  for (const o of orders) {
    if (!o?.is_demo || o.status === "done") continue;
    let cur = { ...o };
    // Догоняем все пропущенные шаги: каждый — через DEMO_STEP_SECONDS после предыдущего
    for (let guard = 0; guard < STATUSES.length; guard++) {
      const next = nextStep(cur, itemsByOrder[o.id]);
      if (!next) break;
      const base = Math.max(new Date(cur.status_changed_at).getTime(), cur.status === "accepted" && cur.paid_at ? new Date(cur.paid_at).getTime() : 0);
      const at = base + DEMO_STEP_SECONDS * 1000;
      if (at > now) break;
      const atIso = new Date(at).toISOString();
      const { data, error } = await ctx.admin
        .from("orders")
        .update({ status: next, substatus: null, status_changed_at: atIso, updated_at: new Date(now).toISOString() })
        .eq("id", o.id)
        .eq("status", cur.status)
        .select("id");
      if (error || !data?.length) break; // кто-то уже сдвинул — не дублируем
      await ctx.admin.from("order_status_history").insert({ order_id: o.id, status: next, source: "system", reason: REASONS[next], at: atIso });
      cur = { ...cur, status: next, status_changed_at: atIso };
      changed = true;
    }
  }
  return changed;
}

// Флаги модерации у заказов списка (для автоодобрения): { orderId: items }
export async function loadItemsForFlags(ctx, orderIds) {
  if (!orderIds.length) return {};
  const { data } = await ctx.db.from("order_items").select("order_id, snapshot").in("order_id", orderIds);
  const out = {};
  for (const r of data || []) (out[r.order_id] ||= []).push(r);
  return out;
}
