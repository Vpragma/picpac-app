import "server-only";
// Облачный ИИ Cloudflare Workers AI (D6, SEC-20): общая часть маршрутов /api/v1/ai/*.
// Порядок проверок каждого вызова: вход → лимит частоты → строгая схема (zod) → согласие → ключи есть →
// квота пользователя и дневной бюджет нейронов (атомарно в базе) → вызов с тайм-аутом 30 с → журнал.
// Ключи CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID читаются только здесь и в браузер не попадают.
// В журнал пишем модель, размер, расход и время — без фото и без текста команды.
import { CloudError, MODELS, cfRun, commandMessages, neuronsFromUsage, parseCommandAnswer } from "@/lib/cloudAi/parse";
import { fakeCommandResult } from "@/lib/cloudAi/fake";
import { CLOUD_LIMITS, CLOUD_SAY, CONSENT_VERSION } from "@/lib/cloudAi/shared";
import { limitWrite } from "./api";
import { jsonError } from "./http";

export function cloudConfigured() {
  return !!(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

// Подмена облака для локальных тестов (AI_CLOUD_FAKE=1): готовые ответы без сети. На Vercel не включается.
export function cloudFake() {
  return process.env.AI_CLOUD_FAKE === "1" && process.env.VERCEL !== "1";
}

export async function hasConsent(ctx) {
  const { data, error } = await ctx.admin.from("ai_cloud_consents").select("version").eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new Error("Согласие: " + error.message);
  return !!data && data.version >= CONSENT_VERSION;
}

export async function usageToday(ctx) {
  const day = new Date().toISOString().slice(0, 10); // сутки по UTC, как у Cloudflare
  const { data } = await ctx.admin.from("ai_cloud_usage").select("calls").eq("day", day).eq("user_id", ctx.userId).maybeSingle();
  const used = data?.calls || 0;
  return { used, limit: CLOUD_LIMITS.perUserDay, left: Math.max(0, CLOUD_LIMITS.perUserDay - used) };
}

export const cloudErrors = {
  consent: () => jsonError(403, "ai_consent_required", CLOUD_SAY.consent + " " + "Разрешите один раз: фото отправится в Cloudflare для обработки и не сохраняется."),
  quota: (reason) => {
    const res = jsonError(429, reason === "budget" ? "ai_budget_exhausted" : "ai_quota_exhausted", CLOUD_SAY.quota);
    res.headers.set("Retry-After", String(secondsToUtcMidnight()));
    return res;
  },
  unavailable: (code = "ai_unavailable") => jsonError(503, code, CLOUD_SAY.unavailable),
  notUnderstood: () => jsonError(422, "ai_not_understood", "Облачный ИИ не понял ответ модели. Попробуйте сказать иначе — или пользуйтесь командами на телефоне."),
};

function secondsToUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(60, Math.round((next - now.getTime()) / 1000));
}

// Проверки до вызова облака. Возвращает { response } (отказ) или { day } (место в квоте занято).
export async function cloudGate(ctx, kind, estimate) {
  const limited = await limitWrite("ai-cloud", ctx.userId, CLOUD_LIMITS.perMinute, 60);
  if (limited) return { response: limited };
  let consent = false;
  try {
    consent = await hasConsent(ctx);
  } catch (e) {
    console.error("ИИ-облако:", e.message);
    return { response: cloudErrors.unavailable() };
  }
  if (!consent) {
    await ctx.audit(`ai.cloud_${kind}`, "ai_cloud", null, "denied", { reason: "no_consent" });
    return { response: cloudErrors.consent() };
  }
  if (!cloudConfigured() && !cloudFake()) {
    await ctx.audit(`ai.cloud_${kind}`, "ai_cloud", null, "error", { reason: "not_configured" });
    return { response: cloudErrors.unavailable("ai_not_configured") };
  }
  const { data, error } = await ctx.admin.rpc("ai_cloud_reserve", { _user: ctx.userId, _user_limit: CLOUD_LIMITS.perUserDay, _budget: CLOUD_LIMITS.budgetDay, _estimate: estimate });
  if (error || !data) {
    console.error("ИИ-облако: квота", error?.message);
    return { response: cloudErrors.unavailable() };
  }
  if (!data.ok) {
    await ctx.audit(`ai.cloud_${kind}`, "ai_cloud", null, "denied", { reason: data.reason === "budget" ? "budget" : "quota", used: data.used });
    return { response: cloudErrors.quota(data.reason) };
  }
  return { day: data.day, used: data.used, limit: data.limit };
}

// После вызова: поправить расход (или вернуть правку, если облако не ответило) и записать в журнал
export async function cloudSettle(ctx, { kind, day, estimate, neurons, refund, model, bytes, ms, result, reason, extra = {} }) {
  const delta = neurons == null ? 0 : Math.round(neurons - estimate);
  try {
    await ctx.admin.rpc("ai_cloud_settle", { _user: ctx.userId, _day: day, _delta: delta, _refund: !!refund });
  } catch (e) {
    console.error("ИИ-облако: учёт", e?.message);
  }
  await ctx.audit(`ai.cloud_${kind}`, "ai_cloud", null, result, {
    model,
    bytes: bytes || 0,
    neurons: neurons ?? estimate,
    ms,
    ...(reason ? { reason } : {}),
    ...extra,
  });
}

// Вызов модели (или подмены). Ошибка облака → CloudError с кодом.
export async function runModel(model, { body, form }, fake) {
  if (cloudFake()) {
    if (typeof fake === "function") return fake();
    throw new CloudError("cf_http", 500);
  }
  return cfRun({
    account: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    model,
    body,
    form,
    timeoutMs: CLOUD_LIMITS.timeoutMs,
  });
}

// Слово-цель или задание по-русски → английский через ту же модель разбора команд (одна операция find/creative).
// Возвращает { en, neurons } или { en: null }. Ошибка облака → CloudError.
export async function translateViaCommand(text, kind) {
  const ask = kind === "target" ? `найди ${text}` : `творческая правка выделенного: ${text}`;
  const result = await runModel(MODELS.command, { body: { messages: commandMessages(ask), max_tokens: 800, temperature: 0.1 } }, () =>
    kind === "target" ? fakeCommandResult("найди") : { response: JSON.stringify({ ops: [{ op: "creative", prompt: "sunset sky" }], say: "" }) },
  );
  const parsed = parseCommandAnswer(result);
  const neurons = neuronsFromUsage(MODELS.command, result?.usage);
  if (!parsed.ok) return { en: null, neurons };
  const op = parsed.ops.find((o) => (kind === "target" ? o.op === "find" || o.op === "remove" : o.op === "creative"));
  return { en: op ? (kind === "target" ? op.target : op.prompt) : null, neurons };
}

// Тело запроса не больше предела (до чтения JSON): 413 с понятным текстом или null
export function bodyTooLarge(request, max = CLOUD_LIMITS.maxBodyBytes) {
  const n = Number(request.headers.get("content-length") || 0);
  if (n > max) return jsonError(413, "too_large", "Фото для облачного ИИ слишком большое. Обновите страницу и попробуйте ещё раз.");
  return null;
}
