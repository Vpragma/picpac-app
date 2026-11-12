// /api/v1/admin/promo — промокоды (N8). Только роль admin: proxy.js (первая линия) и requireUser (вторая).
// GET ?type=general|personal — список со статистикой (сколько раз применён, сколькими клиентами, на какую сумму заказов)
//   и плитки-итоги. POST — создать код. Удалять коды нельзя — только выключить (PATCH /api/v1/admin/promo/{code}).
// Каждое изменение пишется в журнал действий.
import { limitWrite, parseBody, requireUser, serverError } from "@/lib/server/api";
import { loadCatalog } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { auditTerms, createSchema, shapeAdminPromo, toRow, unknownProducts } from "@/lib/server/promoAdmin";

const PERSONAL_LIMIT = 200;

export async function GET(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const type = new URL(request.url).searchParams.get("type") === "personal" ? "personal" : "general";
  try {
    let q = ctx.admin.from("promo_codes").select("*");
    q = type === "personal" ? q.not("owner_user_id", "is", null).order("created_at", { ascending: false }).limit(PERSONAL_LIMIT) : q.is("owner_user_id", null).order("code");
    const [{ data: rows, error }, { data: stats, error: e2 }, cardsAll] = await Promise.all([
      q,
      ctx.admin.rpc("promo_stats"),
      ctx.admin.from("promo_codes").select("code", { count: "exact", head: true }).not("owner_user_id", "is", null),
    ]);
    if (error || e2) throw new Error((error || e2).message);
    const byCode = new Map((stats || []).map((s) => [s.code, s]));
    // Личные коды: номер заказа, к которому выдана открытка (без почты и имени клиента)
    let numbers = {};
    const orderIds = (rows || []).map((r) => r.source_order_id).filter(Boolean);
    if (orderIds.length) {
      const { data: orders } = await ctx.admin.from("orders").select("id, number").in("id", orderIds);
      numbers = Object.fromEntries((orders || []).map((o) => [o.id, o.number]));
    }
    const items = (rows || []).map((r) => shapeAdminPromo(r, byCode.get(r.code), numbers));
    // Итоги: общие коды и открытки отдельно
    const { data: personalCodes } = await ctx.admin.from("promo_codes").select("code").not("owner_user_id", "is", null).limit(5000);
    const personalSet = new Set((personalCodes || []).map((r) => r.code));
    const sum = (pred) =>
      (stats || []).filter(pred).reduce((a, s) => ({ uses: a.uses + s.uses, totalKop: a.totalKop + Number(s.total_kop), discountKop: a.discountKop + Number(s.discount_kop) }), { uses: 0, totalKop: 0, discountKop: 0 });
    const general = sum((s) => !personalSet.has(s.code));
    const cards = sum((s) => personalSet.has(s.code));
    let catalog = null;
    try {
      catalog = await loadCatalog();
    } catch {}
    return json({
      ok: true,
      type,
      items,
      summary: {
        activeCodes: type === "general" ? items.filter((i) => i.status === "active").length : null,
        uses: general.uses,
        totalKop: general.totalKop,
        discountKop: general.discountKop,
        cardsIssued: cardsAll.count || 0,
        cardsUsed: cards.uses,
        cardsTotalKop: cards.totalKop,
      },
      products: (catalog?.products || []).map((p) => ({ slug: p.slug, name: p.name, kind: p.kind })),
      truncated: type === "personal" && items.length >= PERSONAL_LIMIT,
    });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}

export async function POST(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const limited = await limitWrite("admin-promo", ctx.userId, 30, 60);
  if (limited) return limited;
  const { body, response: bad } = await parseBody(request, createSchema);
  if (bad) return bad;
  const unknown = await unknownProducts(body.productSlugs);
  if (unknown) return jsonError(400, "invalid_input", unknown, { fields: { productSlugs: unknown } });
  const row = { ...toRow(body), is_synthetic: false };
  const { data, error } = await ctx.admin.from("promo_codes").insert(row).select("*").maybeSingle();
  if (error?.code === "23505") {
    await ctx.audit("admin.promo_create", "promo", body.code, "denied", { reason: "exists" });
    return jsonError(409, "promo_exists", `Код ${body.code} уже есть. Придумайте другой или измените существующий.`, { fields: { code: "Такой код уже есть." } });
  }
  if (error || !data) {
    console.error(error?.message);
    await ctx.audit("admin.promo_create", "promo", body.code, "error");
    return serverError("promo_save_failed", "Не получилось сохранить промокод. Попробуйте ещё раз.");
  }
  await ctx.audit("admin.promo_create", "promo", data.code, "success", auditTerms(data));
  return json({ ok: true, promo: shapeAdminPromo(data, null) }, 201);
}
