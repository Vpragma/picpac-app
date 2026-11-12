// POST /api/v1/ai/detect { image, target } — найти предмет по слову («машину», «собаку») на уменьшенном кадре.
// image — data:image/jpeg;base64 не больше 1024 точек по длинной стороне (браузер уменьшает до 768).
// Сервер ещё раз убирает из JPEG метаданные (EXIF, GPS) и отправляет кадр модели @cf/moondream/moondream3.1-9B-A2B
// (задача detect, только короткое слово-цель — произвольный запрос к модели наружу не открыт).
// Слово не из словаря переводит gpt-oss-120b. Ответ: рамки в долях 0…1 — по ним редактор выделяет предмет (SlimSAM).
import { parseBody, requireUser, z } from "@/lib/server/api";
import { bodyTooLarge, cloudErrors, cloudGate, cloudSettle, runModel, translateViaCommand } from "@/lib/server/cloudAi";
import { json, jsonError } from "@/lib/server/http";
import { CloudError, ESTIMATE, MODELS, dataUrlToBuffer, neuronsFromUsage, parseDetectAnswer, sanitizeJpeg } from "@/lib/cloudAi/parse";
import { fakeDetectResult } from "@/lib/cloudAi/fake";
import { targetToEnglish } from "@/lib/cloudAi/shared";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 1_000_000;

// Если модель поиска вернула пустой ответ — 10 минут сразу отвечаем «недоступно» (на этом экземпляре сервера)
let detectDownUntil = 0;
const detectUnavailable = () => jsonError(503, "ai_detect_unavailable", "Поиск предмета по слову сейчас недоступен. Коснитесь того, что нужно, — я выделю.");
const schema = z.strictObject({
  image: z.string().min(100, "Нет кадра.").max(1_400_000, "Кадр слишком большой."),
  target: z.string().trim().min(1, "Напишите, что найти.").max(60, "Слишком длинное название — до 60 символов."),
});

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const big = bodyTooLarge(request, 1_500_000);
  if (big) return big;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  const raw = dataUrlToBuffer(body.image, MAX_IMAGE_BYTES);
  const jpeg = raw && sanitizeJpeg(raw);
  if (!jpeg) return jsonError(400, "invalid_input", "Кадр должен быть фото JPEG до 1 МБ. Обновите страницу и попробуйте ещё раз.", { fields: { image: "Нужен JPEG." } });
  if (Math.max(jpeg.width, jpeg.height) > 1024) return jsonError(400, "invalid_input", "Кадр нужно уменьшить до 1024 точек по длинной стороне.", { fields: { image: "Больше 1024 точек." } });

  if (Date.now() < detectDownUntil) return detectUnavailable();
  let en = targetToEnglish(body.target);
  const estimate = ESTIMATE.detect + (en ? 0 : ESTIMATE.translate);
  const gate = await cloudGate(ctx, "detect", estimate);
  if (gate.response) return gate.response;

  const t0 = Date.now();
  const base = { kind: "detect", day: gate.day, estimate, model: MODELS.detect, bytes: jpeg.buf.length };
  let neurons = 0;
  let counted = true;
  try {
    if (!en) {
      const tr = await translateViaCommand(body.target, "target");
      neurons += tr.neurons ?? ESTIMATE.translate;
      en = tr.en;
      if (!en) {
        await cloudSettle(ctx, { ...base, neurons, ms: Date.now() - t0, result: "error", reason: "no_target" });
        return json({ ok: true, boxes: [], target: null, say: "Не понял, что искать. Коснитесь того, что нужно, — я выделю." });
      }
    }
    const dataUrl = "data:image/jpeg;base64," + jpeg.buf.toString("base64");
    const result = await runModel(MODELS.detect, { body: { task: "detect", image: dataUrl, target: en, max_objects: 5 } }, fakeDetectResult);
    const n = neuronsFromUsage(MODELS.detect, result?.metrics);
    if (n == null) counted = false;
    neurons += n ?? ESTIMATE.detect;
    const parsed = parseDetectAnswer(result, jpeg.width, jpeg.height);
    const empty = !parsed.ok && parsed.reason === "empty_result";
    await cloudSettle(ctx, {
      ...base,
      neurons,
      refund: empty, // модель ничего не вернула — правку пользователю возвращаем
      ms: Date.now() - t0,
      result: parsed.ok ? "success" : "error",
      reason: parsed.ok ? undefined : parsed.reason,
      extra: { found: parsed.ok ? parsed.boxes.length : 0, ...(counted ? {} : { estimated: true }) },
    });
    if (empty) {
      detectDownUntil = Date.now() + 10 * 60_000; // модель не отвечает — 10 минут не тратим вызовы
      return detectUnavailable();
    }
    if (!parsed.ok) return cloudErrors.notUnderstood();
    return json({ ok: true, boxes: parsed.boxes, target: en, left: Math.max(0, gate.limit - gate.used) });
  } catch (e) {
    const code = e instanceof CloudError ? e.code : "error";
    if (!(e instanceof CloudError)) console.error("ИИ-облако: поиск", e?.message);
    await cloudSettle(ctx, { ...base, neurons: neurons || null, refund: true, ms: Date.now() - t0, result: "error", reason: code, extra: { status: e?.status || 0 } });
    if (code === "cf_quota") return cloudErrors.quota("budget");
    return cloudErrors.unavailable(code === "cf_timeout" ? "ai_timeout" : "ai_unavailable");
  }
}
