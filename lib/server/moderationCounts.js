import "server-only";
// Счётчики модерации — один источник для «Обзора», «Статистики» и очереди модератора (N7, круг 1).
// Раньше было три разных числа под похожими подписями: «Обзор» считал заказы на «Модерации» среди последних 30
// (вместе с синтетикой), «Статистика» — заказы на «Модерации» во всей базе, очередь — фото только настоящих заказов.
// Теперь — две разные вещи с честными подписями, обе «сейчас», не за период:
//   • фото ждут проверки (photosWaiting) — ровно очередь модератора: проверка «pending» с файлом фото
//     в НЕ синтетическом заказе на «Модерации» (у синтетических заказов фото нет — проверять нечего);
//     ordersWithPhotos — в скольких заказах эти фото;
//   • заказы на модерации (orders) — заказы в статусе «Модерация» во всей базе — то же число, что плитка
//     «Заказы на модерации» в «Статистике» с «Все данные»; synthetic — сколько из них синтетика (демо-набор).

// Очередь модератора: тот же фильтр для списка и для счётчика (иначе «Очередь (N)» и список расходятся)
export function queueQuery(db, select, options) {
  return db
    .from("moderation_reviews")
    .select(select, options)
    .eq("decision", "pending")
    .eq("orders.status", "moderation")
    .eq("orders.is_synthetic", false)
    .not("photo_path", "is", null);
}

// Фото и заказы в очереди: { photosWaiting, ordersWithPhotos }
export async function queueCounts(db) {
  const { data, count, error } = await queueQuery(db, "order_id, orders!inner(id)", { count: "exact" }).limit(1000);
  if (error) throw new Error(error.message);
  return { photosWaiting: count || 0, ordersWithPhotos: new Set((data || []).map((r) => r.order_id)).size };
}

// Всё для плиток «Обзора»: очередь + заказы на «Модерации» (всего и из них синтетика)
export async function moderationCounts(db) {
  const head = { count: "exact", head: true };
  const [queue, all, synthetic] = await Promise.all([
    queueCounts(db),
    db.from("orders").select("id", head).eq("status", "moderation"),
    db.from("orders").select("id", head).eq("status", "moderation").eq("is_synthetic", true),
  ]);
  if (all.error || synthetic.error) throw new Error((all.error || synthetic.error).message);
  return { ...queue, orders: all.count || 0, synthetic: synthetic.count || 0 };
}
