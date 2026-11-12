// POST /api/v1/admin/moderation/{id} { decision: "approve" | "return", reason?, comment? } — решение модератора.
// «Вернуть на замену» — только с причиной из списка; клиент получает уведомление «Нужно заменить фото».
// «Одобрить» — если других фото на проверке нет, заказ уходит в «Производство» (та же функция, что события ERP).
// Повторное решение → 409 already_decided. Автоматика сама никогда не отклоняет.
// Журнал: решение модератора и рядом решение модели (коды находок, без фото и без процентов).
import { badId, limitWrite, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { findingCodes, RETURN_REASONS, reviewFindings } from "@/lib/moderation";

const schema = z
  .strictObject({
    decision: z.enum(["approve", "return"], { error: "Выберите: одобрить или вернуть на замену." }),
    reason: z.enum(Object.keys(RETURN_REASONS), { error: "Выберите причину из списка." }).optional(),
    comment: z.string().trim().max(500, "Комментарий — до 500 символов.").optional(),
  })
  .refine((b) => b.decision !== "return" || !!b.reason, { message: "Выберите причину возврата.", path: ["reason"] });

const CODES = {
  already_decided: [409, "Решение по этому фото уже принято."],
  not_in_moderation: [409, "Заказ уже не на модерации."],
  reason_required: [400, "Выберите причину возврата."],
};

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request, ["moderator", "admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  const limited = await limitWrite("moderation", ctx.userId, 120);
  if (limited) return limited;
  if (badId(id)) return notFound("Фото на проверке");
  const { data: rev } = await ctx.admin.from("moderation_reviews").select("auto_scores, project_photos(moderation, nsfw)").eq("id", id).maybeSingle();
  const model = rev ? findingCodes(reviewFindings({ verdict: rev.project_photos?.moderation, device: rev.project_photos?.nsfw ?? rev.auto_scores }).list) : [];
  const { data, error } = await ctx.admin.rpc("moderation_decide", {
    _review: id,
    _decision: body.decision,
    _reason: body.reason || null,
    _comment: body.comment || null,
    _actor: ctx.userId,
  });
  if (error) {
    console.error("moderation_decide:", error.message);
    return serverError();
  }
  const action = body.decision === "approve" ? "moderation.approve" : "moderation.return";
  if (data?.result !== "applied") {
    if (data?.code === "not_found") return notFound("Фото на проверке");
    const [status, message] = CODES[data?.code] || [409, "Решение сейчас принять нельзя."];
    await ctx.audit(action, "moderation_review", id, "denied", { reason: data?.code });
    return jsonError(status, data?.code || "conflict", message, data?.code === "reason_required" ? { fields: { reason: message } } : {});
  }
  await ctx.audit(action, "moderation_review", id, "success", { reason: body.reason || null, status: data.status, model });
  return json({ ok: true, decision: data.decision, orderStatus: data.status, waiting: !!data.waiting });
}
