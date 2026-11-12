// POST /api/v1/ai/command { text } — свободная команда, которую не понял словарь на устройстве,
// разбирает облачная модель @cf/openai/gpt-oss-120b. Ответ — только операции, которые редактор уже умеет
// (свет, цвет, автоулучшение, размыть фон, убрать/найти предмет, творческая правка, отменить, вернуть оригинал).
// Ответ модели проверяется строго (zod); всё непонятное → 422, редактор остаётся на словаре.
// Проверки и квоты — lib/server/cloudAi.js. Ошибки: 401, 403 (нет согласия), 429 (лимит), 503 (облако недоступно).
import { parseBody, requireUser, z } from "@/lib/server/api";
import { bodyTooLarge, cloudErrors, cloudGate, cloudSettle, runModel } from "@/lib/server/cloudAi";
import { json } from "@/lib/server/http";
import { CloudError, ESTIMATE, MODELS, commandMessages, neuronsFromUsage, parseCommandAnswer } from "@/lib/cloudAi/parse";
import { fakeCommandResult } from "@/lib/cloudAi/fake";

export const maxDuration = 60;

const schema = z.strictObject({
  text: z.string().trim().min(1, "Напишите, что изменить.").max(300, "Команда слишком длинная — до 300 символов."),
});

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const big = bodyTooLarge(request, 20_000);
  if (big) return big;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  const gate = await cloudGate(ctx, "command", ESTIMATE.command);
  if (gate.response) return gate.response;

  const t0 = Date.now();
  const base = { kind: "command", day: gate.day, estimate: ESTIMATE.command, model: MODELS.command, bytes: Buffer.byteLength(body.text) };
  let result;
  try {
    result = await runModel(MODELS.command, { body: { messages: commandMessages(body.text), max_tokens: 1200, temperature: 0.2 } }, () => fakeCommandResult(body.text));
  } catch (e) {
    const code = e instanceof CloudError ? e.code : "error";
    if (!(e instanceof CloudError)) console.error("ИИ-облако: команда", e?.message);
    await cloudSettle(ctx, { ...base, neurons: null, refund: true, ms: Date.now() - t0, result: "error", reason: code, extra: { status: e?.status || 0 } });
    if (code === "cf_quota") return cloudErrors.quota("budget");
    return cloudErrors.unavailable(code === "cf_timeout" ? "ai_timeout" : "ai_unavailable");
  }
  const parsed = parseCommandAnswer(result);
  const neurons = neuronsFromUsage(MODELS.command, result?.usage);
  await cloudSettle(ctx, {
    ...base,
    neurons,
    ms: Date.now() - t0,
    result: parsed.ok ? "success" : "error",
    reason: parsed.ok ? undefined : parsed.reason,
    extra: parsed.ok ? { ops: parsed.ops.map((o) => o.op).join(",") } : {},
  });
  if (!parsed.ok) return cloudErrors.notUnderstood();
  return json({ ok: true, ops: parsed.ops, say: parsed.say, left: Math.max(0, gate.limit - gate.used) });
}
