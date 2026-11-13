// GET /api/v1/admin/moderation — очередь модерации (модератор и админ): фото с флагом из заказов на «Модерации».
//   Вывод модели — словами (N4): «Найдено: обнажённая грудь (высокая уверенность)», без процентов и сырых оценок.
//   Фото — по подписанной ссылке на 10 минут. Данные клиента замаскированы (SEC-14): только инициалы, без адреса.
//   stats — сколько фото ждёт (pending) и в скольких заказах (orders), среднее время проверки за 7 дней, решений за сутки.
//   В журнал — moderation.view.
// GET ?view=history — последние 30 решений: решение модели и модератора, причина, время. Без фото и без данных клиента.
import { requireUser, serverError } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { maskClient } from "@/lib/mask";
import { describeFinding, RETURN_REASONS, reviewFindings } from "@/lib/moderation";
import { queueCounts, queueQuery } from "@/lib/server/moderationCounts";

const words = (r) => {
  const f = reviewFindings({ verdict: r.project_photos?.moderation, device: r.project_photos?.nsfw ?? r.auto_scores });
  return { source: f.source, findings: f.list.map((x) => ({ id: x.id, level: x.level, text: describeFinding(x) })) };
};

async function stats(ctx) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const dayAgo = Date.now() - 86400_000;
  const [queue, { data: done }] = await Promise.all([
    queueCounts(ctx.admin),
    ctx.admin
      .from("moderation_reviews")
      .select("created_at, decided_at, orders!inner(is_synthetic)")
      .neq("decision", "pending")
      .eq("orders.is_synthetic", false)
      .gte("decided_at", weekAgo)
      .order("decided_at", { ascending: false })
      .limit(500),
  ]);
  const mins = (done || []).filter((r) => r.decided_at && r.created_at).map((r) => (new Date(r.decided_at) - new Date(r.created_at)) / 60000);
  return {
    // N7: «Фото ждут проверки» — тот же счётчик, что плитка «Обзора» (lib/server/moderationCounts.js)
    pending: queue.photosWaiting,
    orders: queue.ordersWithPhotos,
    avgMinutes: mins.length ? Math.round((mins.reduce((a, b) => a + b, 0) / mins.length) * 10) / 10 : null,
    decided7d: mins.length,
    decided24h: (done || []).filter((r) => new Date(r.decided_at).getTime() >= dayAgo).length,
  };
}

async function history(ctx) {
  const { data, error } = await ctx.admin
    .from("moderation_reviews")
    .select("id, photo_index, auto_scores, decision, reason, comment, moderator_id, created_at, decided_at, project_photos(moderation, nsfw), orders!inner(number, is_synthetic)")
    .neq("decision", "pending")
    .eq("orders.is_synthetic", false)
    .not("decided_at", "is", null)
    .order("decided_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  return data.map((r) => ({
    id: r.id,
    orderNumber: r.orders.number,
    photoIndex: r.photo_index,
    decision: r.decision,
    reason: r.reason || null,
    reasonText: r.reason ? RETURN_REASONS[r.reason] || r.reason : null,
    comment: r.comment || null,
    byMe: r.moderator_id === ctx.userId,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
    minutes: Math.max(0, Math.round((new Date(r.decided_at) - new Date(r.created_at)) / 60000)),
    ...words(r),
  }));
}

export async function GET(request) {
  const { ctx, response } = await requireUser(request, ["moderator", "admin"]);
  if (response) return response;
  try {
    if (new URL(request.url).searchParams.get("view") === "history") {
      const [items, st] = await Promise.all([history(ctx), stats(ctx)]);
      return json({ ok: true, items, stats: st });
    }
    // Список и счётчик — один фильтр (queueQuery): «Очередь (N)» совпадает со списком
    const { data, error } = await queueQuery(ctx.admin, "id, order_id, photo_path, photo_index, auto_scores, created_at, project_photos(moderation, nsfw), orders!inner(id, number, status, is_synthetic, recipient, created_at)")
      .order("created_at")
      .limit(50);
    if (error) throw new Error(error.message);
    // N7: фото одного заказа — по номеру в заказе (время постановки в очередь у них совпадает почти до мс,
    // и порядок выходил 2, 1, 3); заказы — по-прежнему по времени (sort устойчивый)
    const rank = new Map();
    for (const r of data) if (!rank.has(r.order_id)) rank.set(r.order_id, rank.size);
    data.sort((a, b) => rank.get(a.order_id) - rank.get(b.order_id) || (a.photo_index ?? 0) - (b.photo_index ?? 0));
    const paths = data.map((r) => r.photo_path);
    const urls = {};
    if (paths.length) {
      const { data: signed } = await ctx.admin.storage.from("photos").createSignedUrls(paths, 600);
      for (const s of signed || []) if (s.signedUrl && !s.error) urls[s.path] = s.signedUrl;
    }
    const items = data.map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderNumber: r.orders.number,
      photoIndex: r.photo_index,
      url: urls[r.photo_path] || null,
      ...words(r),
      client: maskClient(r.orders, "moderator"),
      createdAt: r.created_at,
    }));
    const st = await stats(ctx);
    if (items.length) await ctx.audit("moderation.view", "order", null, "success", { reviews: items.map((i) => i.id).slice(0, 50) });
    return json({ ok: true, items, stats: st });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}
