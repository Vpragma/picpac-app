// POST /api/v1/ai/edit { image, prompt } — творческая правка выделенной части («небо на закат», «добавь снег»).
// image — вырезка вокруг выделения, data:image/jpeg;base64, длинная сторона ≤ 512 (метаданные сервер убирает ещё раз).
// Модель @cf/black-forest-labs/flux-2-klein-4b (Apache-2.0) правит вырезку по заданию на английском
// (русское задание переводит gpt-oss-120b). Ответ — картинка того же размера; вклеивает её редактор
// только внутри маски с мягким краем, остальное фото не меняется.
import { parseBody, requireUser, z } from "@/lib/server/api";
import { bodyTooLarge, cloudErrors, cloudGate, cloudSettle, runModel, translateViaCommand } from "@/lib/server/cloudAi";
import { json, jsonError } from "@/lib/server/http";
import { CloudError, ESTIMATE, MODELS, dataUrlToBuffer, parseEditAnswer, sanitizeJpeg } from "@/lib/cloudAi/parse";
import { fakeEditResult } from "@/lib/cloudAi/fake";
import { outSize } from "@/lib/cloudAi/shared";

export const maxDuration = 60;

const schema = z.strictObject({
  image: z.string().min(100, "Нет вырезки.").max(700_000, "Вырезка слишком большая."),
  prompt: z.string().trim().min(3, "Напишите, что сделать.").max(200, "Слишком длинное задание — до 200 символов."),
});

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const big = bodyTooLarge(request, 800_000);
  if (big) return big;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  const raw = dataUrlToBuffer(body.image, 500_000);
  const jpeg = raw && sanitizeJpeg(raw);
  if (!jpeg) return jsonError(400, "invalid_input", "Вырезка должна быть фото JPEG до 500 КБ.", { fields: { image: "Нужен JPEG." } });
  if (Math.max(jpeg.width, jpeg.height) > 512) return jsonError(400, "invalid_input", "Вырезку нужно уменьшить до 512 точек по длинной стороне.", { fields: { image: "Больше 512 точек." } });

  const ascii = /^[\x20-\x7E]{3,200}$/.test(body.prompt);
  const estimate = ESTIMATE.edit + (ascii ? 0 : ESTIMATE.translate);
  const gate = await cloudGate(ctx, "edit", estimate);
  if (gate.response) return gate.response;

  const t0 = Date.now();
  const base = { kind: "edit", day: gate.day, estimate, model: MODELS.edit, bytes: jpeg.buf.length };
  let neurons = 0;
  try {
    let prompt = ascii ? body.prompt : null;
    if (!prompt) {
      const tr = await translateViaCommand(body.prompt, "prompt");
      neurons += tr.neurons ?? ESTIMATE.translate;
      prompt = tr.en;
      if (!prompt) {
        await cloudSettle(ctx, { ...base, neurons, ms: Date.now() - t0, result: "error", reason: "no_prompt" });
        return cloudErrors.notUnderstood();
      }
    }
    const { width, height } = outSize(jpeg.width, jpeg.height);
    const form = new FormData();
    form.append("prompt", prompt);
    form.append("input_image_0", new Blob([jpeg.buf], { type: "image/jpeg" }), "crop.jpg");
    form.append("width", String(width));
    form.append("height", String(height));
    const result = await runModel(MODELS.edit, { form }, fakeEditResult);
    // Цена FLUX по плиткам 512×512: вход ≈ 5,4 нейрона, выход ≈ 26 нейронов
    neurons += Math.ceil(5.37 + 26.05 * ((width * height) / (512 * 512)));
    const parsed = parseEditAnswer(result);
    await cloudSettle(ctx, { ...base, neurons, ms: Date.now() - t0, result: parsed.ok ? "success" : "error", reason: parsed.ok ? undefined : parsed.reason, extra: { width, height } });
    if (!parsed.ok) return cloudErrors.notUnderstood();
    return json({ ok: true, image: `data:${parsed.mime};base64,${parsed.base64}`, width, height, left: Math.max(0, gate.limit - gate.used) });
  } catch (e) {
    const code = e instanceof CloudError ? e.code : "error";
    if (!(e instanceof CloudError)) console.error("ИИ-облако: правка", e?.message);
    await cloudSettle(ctx, { ...base, neurons: neurons || null, refund: true, ms: Date.now() - t0, result: "error", reason: code, extra: { status: e?.status || 0 } });
    if (code === "cf_quota") return cloudErrors.quota("budget");
    return cloudErrors.unavailable(code === "cf_timeout" ? "ai_timeout" : "ai_unavailable");
  }
}
