import "server-only";
// Симулятор производства (мок ERP) для демо-заказов. Шаги делает база: public.erp_tick_orders → erp_apply_event —
// та же функция, что принимает события настоящего ERP, поэтому правила и лента одинаковые.
// Продвижение ленивое: при чтении заказов (GET /orders, GET /orders/{id}, GET /notifications).
// Шаг — 30 с (private.app_settings → erp_sim), доставка — вдвое дольше. pg_cron пока не включён (общая база, см. README).

// Продвинуть заказы, у которых подошло время. true — что-то изменилось (тогда заказ перечитать).
export async function advanceDemoOrders(ctx, orders) {
  const ids = (orders || []).filter((o) => o?.is_demo && o.status !== "done").map((o) => o.id);
  if (!ids.length) return false;
  const { data, error } = await ctx.admin.rpc("erp_tick_orders", { _orders: ids });
  if (error) {
    console.error("erp_tick_orders:", error.message);
    return false;
  }
  return Number(data) > 0;
}
