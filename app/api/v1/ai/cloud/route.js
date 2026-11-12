// GET /api/v1/ai/cloud — облачный ИИ для вошедшего клиента: включён ли, есть ли согласие, сколько правок осталось сегодня.
// Без входа — 401. Ключи и их значения не возвращаются никогда.
import { requireUser, serverError } from "@/lib/server/api";
import { cloudConfigured, cloudFake, hasConsent, usageToday } from "@/lib/server/cloudAi";
import { json } from "@/lib/server/http";
import { CLOUD_LIMITS, CONSENT_TEXT } from "@/lib/cloudAi/shared";

export async function GET(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  try {
    const [consent, usage] = await Promise.all([hasConsent(ctx), usageToday(ctx)]);
    return json({
      ok: true,
      available: cloudConfigured() || cloudFake(),
      consent,
      consentText: CONSENT_TEXT,
      used: usage.used,
      limit: usage.limit,
      left: usage.left,
      limits: { perMinute: CLOUD_LIMITS.perMinute, detectSide: CLOUD_LIMITS.detectSide, editSide: CLOUD_LIMITS.editSide },
      ...(cloudFake() ? { fake: true } : {}),
    });
  } catch (e) {
    console.error("ИИ-облако: статус", e?.message);
    return serverError();
  }
}
