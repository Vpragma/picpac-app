// /api/v1/cart — моя корзина на сервере.
// GET — позиции с ценами (сервер считает сам); ?delivery=code&promo=CODE — ещё и итог с доставкой и скидкой.
// PUT { items: [{ projectId, quantity }] } — заменить корзину целиком.
import { calcTotals } from "@/lib/pricing";
import { parseBody, requireUser, serverError, uuid, z } from "@/lib/server/api";
import { findDelivery, findPromo } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { loadCart, shapeCart } from "@/lib/server/projects";

const schema = z.object({
  items: z
    .array(z.object({ projectId: uuid, quantity: z.number().int().min(1, "Количество — от 1.").max(99, "Количество — до 99.") }))
    .max(50, "В корзине может быть до 50 позиций."),
});

export async function GET(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  try {
    const cart = await loadCart(ctx);
    const url = new URL(request.url);
    const method = findDelivery(cart.catalog, url.searchParams.get("delivery") || "");
    const code = url.searchParams.get("promo");
    const promo = code ? await findPromo(code) : null;
    const lines = cart.items.filter((i) => i.valid).map((i) => ({ lineKop: i.lineTotalKop }));
    const totals = calcTotals({ lines, method, promo: code ? promo || { active: false } : null });
    return json({ ok: true, cart: shapeCart(cart), totals: { ...totals, delivery: method ? method.code : null } });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}

export async function PUT(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  const ids = [...new Set(body.items.map((i) => i.projectId))];
  if (ids.length !== body.items.length) return jsonError(400, "invalid_input", "Один проект попал в корзину дважды.");
  if (ids.length) {
    const { data: own } = await ctx.db.from("projects").select("id, status").in("id", ids).eq("user_id", ctx.userId);
    const ok = new Map((own || []).map((p) => [p.id, p.status]));
    const foreign = ids.filter((id) => !ok.has(id));
    if (foreign.length) {
      await ctx.audit("cart.update", "cart", ctx.userId, "denied", { reason: "foreign_project", projects: foreign });
      return jsonError(404, "not_found", "Проект не найден. Возможно, его удалили.");
    }
    if (ids.some((id) => ok.get(id) === "ordered")) return jsonError(409, "project_ordered", "Проект уже заказан. Создайте новый, чтобы заказать ещё раз.");
  }

  try {
    const { data: before } = await ctx.db.from("cart_items").select("project_id").eq("user_id", ctx.userId);
    const removed = (before || []).map((r) => r.project_id).filter((id) => !ids.includes(id));
    if (removed.length) {
      await ctx.admin.from("cart_items").delete().eq("user_id", ctx.userId).in("project_id", removed);
      await ctx.admin.from("projects").update({ status: "draft" }).eq("user_id", ctx.userId).in("id", removed).eq("status", "in_cart");
    }
    if (ids.length) {
      const rows = body.items.map((i) => ({ user_id: ctx.userId, project_id: i.projectId, quantity: i.quantity, updated_at: new Date().toISOString() }));
      const { error } = await ctx.admin.from("cart_items").upsert(rows, { onConflict: "user_id,project_id" });
      if (error) throw new Error(error.message);
      await ctx.admin.from("projects").update({ status: "in_cart" }).eq("user_id", ctx.userId).in("id", ids).eq("status", "draft");
    }
    await ctx.audit("cart.update", "cart", ctx.userId, "success", { items: ids.length, removed: removed.length });
    return json({ ok: true, cart: shapeCart(await loadCart(ctx)) });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("cart.update", "cart", ctx.userId, "error");
    return serverError();
  }
}
