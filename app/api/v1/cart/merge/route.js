// POST /api/v1/cart/merge { items: [{ projectId, quantity }] } — перенести гостевую корзину в аккаунт.
// Проекты гостя к этому моменту уже созданы в аккаунте (POST /api/v1/projects). Количества складываются (до 99).
import { parseBody, requireUser, serverError, uuid, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { loadCart, shapeCart } from "@/lib/server/projects";

const schema = z.strictObject({
  items: z.array(z.strictObject({ projectId: uuid, quantity: z.number().int().min(1).max(99) })).max(50, "В корзине может быть до 50 позиций."),
});

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  try {
    const ids = body.items.map((i) => i.projectId);
    const { data: own } = ids.length
      ? await ctx.db.from("projects").select("id, status").in("id", ids).eq("user_id", ctx.userId).neq("status", "ordered")
      : { data: [] };
    const allowed = new Set((own || []).map((p) => p.id));
    const { data: current } = await ctx.db.from("cart_items").select("project_id, quantity").eq("user_id", ctx.userId);
    const have = new Map((current || []).map((r) => [r.project_id, r.quantity]));
    const rows = body.items
      .filter((i) => allowed.has(i.projectId))
      .map((i) => ({
        user_id: ctx.userId,
        project_id: i.projectId,
        quantity: Math.min(99, (have.get(i.projectId) || 0) + i.quantity),
        updated_at: new Date().toISOString(),
      }));
    if (rows.length) {
      const { error } = await ctx.admin.from("cart_items").upsert(rows, { onConflict: "user_id,project_id" });
      if (error) throw new Error(error.message);
      await ctx.admin.from("projects").update({ status: "in_cart" }).eq("user_id", ctx.userId).in("id", [...allowed]).eq("status", "draft");
    }
    const skipped = body.items.length - rows.length;
    // Чужой, заказанный или несуществующий проект в запросе — отказ в журнале (не «успех»)
    await ctx.audit("cart.merge", "cart", ctx.userId, skipped ? "denied" : "success", { merged: rows.length, skipped, ...(skipped ? { reason: "foreign_or_ordered" } : {}) });
    return json({ ok: true, merged: rows.length, skipped, cart: shapeCart(await loadCart(ctx)) });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("cart.merge", "cart", ctx.userId, "error");
    return serverError();
  }
}
