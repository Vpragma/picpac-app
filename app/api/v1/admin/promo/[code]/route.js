// PATCH /api/v1/admin/promo/{code} — изменить условия кода или выключить/включить его (N8). Только роль admin.
// Код (название) не меняется; удалить нельзя — только { active: false }. Каждое изменение — в журнал действий
// (что было → что стало). Выключенный код перестаёт работать сразу: сервер читает коды без кэша.
import { limitWrite, parseBody, requireUser, serverError } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { normalizeCode, shapePromo } from "@/lib/promo";
import { auditTerms, shapeAdminPromo, termsError, toDay, toRow, unknownProducts, updateSchema } from "@/lib/server/promoAdmin";

export async function PATCH(request, { params }) {
  const { code: raw } = await params;
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const limited = await limitWrite("admin-promo", ctx.userId, 30, 60);
  if (limited) return limited;
  const code = normalizeCode(decodeURIComponent(raw || ""));
  if (!code) return jsonError(404, "not_found", "Промокод не найден.");
  const { body, response: bad } = await parseBody(request, updateSchema);
  if (bad) return bad;

  const { data: before, error: e1 } = await ctx.admin.from("promo_codes").select("*").eq("code", code).maybeSingle();
  if (e1) return serverError();
  if (!before) return jsonError(404, "not_found", "Промокод не найден.");
  const unknown = await unknownProducts(body.productSlugs);
  if (unknown) return jsonError(400, "invalid_input", unknown, { fields: { productSlugs: unknown } });

  // Условия после правки — проверяем целиком (процент 1–100, даты по порядку)
  const cur = shapePromo(before);
  const merged = {
    kind: body.kind ?? cur.kind,
    value: body.value ?? cur.value,
    validFrom: body.validFrom !== undefined ? body.validFrom : toDay(cur.validFrom),
    validTo: body.validTo !== undefined ? body.validTo : toDay(cur.validTo),
  };
  const err = termsError(merged);
  if (err) return jsonError(400, "invalid_input", `Проверьте данные: ${err[1]}`, { fields: { [err[0]]: err[1] } });

  const patch = { ...toRow({ ...body, kind: merged.kind, value: body.value ?? (body.kind ? merged.value : undefined) }), updated_at: new Date().toISOString() };
  if (body.kind === undefined) delete patch.kind;
  const { data: after, error } = await ctx.admin.from("promo_codes").update(patch).eq("code", code).select("*").maybeSingle();
  if (error || !after) {
    console.error(error?.message);
    await ctx.audit("admin.promo_update", "promo", code, "error");
    return serverError("promo_save_failed", "Не получилось сохранить промокод. Попробуйте ещё раз.");
  }
  const onlyToggle = Object.keys(body).length === 1 && body.active !== undefined;
  const action = onlyToggle ? (body.active ? "admin.promo_enable" : "admin.promo_disable") : "admin.promo_update";
  await ctx.audit(action, "promo", code, "success", { before: auditTerms(before), after: auditTerms(after), personal: !!after.owner_user_id });
  return json({ ok: true, promo: shapeAdminPromo(after, null) });
}
