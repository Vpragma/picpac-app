// GET /api/v1/admin/moderation — очередь модерации (модератор и админ): фото с флагом цензуры из заказов на «Модерации».
// Фото — по подписанной ссылке на 10 минут. Данные клиента замаскированы (SEC-14): модератор видит только инициалы,
// без адреса. В журнал — moderation.view со списком записей.
import { requireUser, serverError } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { maskClient } from "@/lib/mask";

export async function GET(request) {
  const { ctx, response } = await requireUser(request, ["moderator", "admin"]);
  if (response) return response;
  try {
    const { data, error } = await ctx.admin
      .from("moderation_reviews")
      .select("id, order_id, photo_path, photo_index, auto_scores, created_at, orders!inner(id, number, status, is_synthetic, recipient, created_at)")
      .eq("decision", "pending")
      .eq("orders.status", "moderation")
      .eq("orders.is_synthetic", false)
      .not("photo_path", "is", null)
      .order("created_at")
      .limit(50);
    if (error) throw new Error(error.message);
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
      scores: r.auto_scores ? { porn: r.auto_scores.porn, hentai: r.auto_scores.hentai, sexy: r.auto_scores.sexy } : null,
      client: maskClient(r.orders, "moderator"),
      createdAt: r.created_at,
    }));
    if (items.length) await ctx.audit("moderation.view", "order", null, "success", { reviews: items.map((i) => i.id).slice(0, 50) });
    return json({ ok: true, items });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}
