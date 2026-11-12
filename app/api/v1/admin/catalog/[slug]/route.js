// PATCH /api/v1/admin/catalog/{slug} — правка продукта администратором (N9).
// { basePriceKop?, per2PagesKop?, badge?: "новинка" | "скидка" | "выбор pic pac" | null, oldPriceKop?: число | null,
//   sizes?: [{ code, priceK?, unitPriceKop? }] }. Цены — целые копейки в разумных пределах, старая цена > текущей «от».
// Только роль admin. Каждая правка — запись в журнал (admin.catalog_update: что было → что стало).
import { limitWrite, parseBody, requireUser, serverError } from "@/lib/server/api";
import { catalogPatch, updateProduct } from "@/lib/server/adminCatalog";
import { json, jsonError } from "@/lib/server/http";

export async function PATCH(request, { params }) {
  const { slug } = await params;
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  if (!/^[a-z0-9-]{2,40}$/.test(String(slug))) return jsonError(404, "not_found", "Продукт не найден.");
  const { body, response: bad } = await parseBody(request, catalogPatch);
  if (bad) {
    await ctx.audit("admin.catalog_update", "product", slug, "denied", { reason: "bad_price" });
    return bad;
  }
  const limited = await limitWrite("catalog", ctx.userId, 60);
  if (limited) return limited;
  try {
    const r = await updateProduct(ctx.admin, slug, body);
    if (r.error) {
      await ctx.audit("admin.catalog_update", "product", slug, "denied", { reason: r.error.code === "old_price" ? "old_price" : r.error.code });
      return jsonError(r.error.status, r.error.code, r.error.message, r.error.field ? { fields: { [r.error.field]: r.error.message } } : {});
    }
    if (Object.keys(r.changes).length) await ctx.audit("admin.catalog_update", "product", slug, "success", { changes: r.changes });
    return json({ ok: true, changed: Object.keys(r.changes), product: r.product });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("admin.catalog_update", "product", slug, "error", { reason: "db_error" });
    return serverError();
  }
}
