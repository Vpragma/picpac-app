// POST /api/v1/ai/consent { accept: true } — согласие на облачный ИИ (один раз на аккаунт).
// DELETE /api/v1/ai/consent — отозвать согласие. Оба действия — в журнале.
import { limitWrite, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json, sameOrigin, jsonError } from "@/lib/server/http";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/cloudAi/shared";

const schema = z.strictObject({ accept: z.literal(true, { error: "Нужно нажать «Разрешить»." }) });

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limited = await limitWrite("ai-consent", ctx.userId, 10, 60);
  if (limited) return limited;
  const { response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  const { error } = await ctx.admin
    .from("ai_cloud_consents")
    .upsert({ user_id: ctx.userId, accepted_at: new Date().toISOString(), version: CONSENT_VERSION }, { onConflict: "user_id" });
  if (error) {
    console.error("ИИ-облако: согласие", error.message);
    await ctx.audit("ai.cloud_consent", "ai_cloud", null, "error", {});
    return serverError();
  }
  await ctx.audit("ai.cloud_consent", "ai_cloud", null, "success", { version: CONSENT_VERSION });
  return json({ ok: true, consent: true, consentText: CONSENT_TEXT });
}

export async function DELETE(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  const limited = await limitWrite("ai-consent", ctx.userId, 10, 60);
  if (limited) return limited;
  const { error } = await ctx.admin.from("ai_cloud_consents").delete().eq("user_id", ctx.userId);
  if (error) {
    console.error("ИИ-облако: отзыв согласия", error.message);
    return serverError();
  }
  await ctx.audit("ai.cloud_consent_revoke", "ai_cloud", null, "success", {});
  return json({ ok: true, consent: false });
}
