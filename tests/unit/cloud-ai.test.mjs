// D6: облачный ИИ — разбор ответов Cloudflare (с подменой ответа), строгая схема, перевод цели, рамки, JPEG без метаданных,
// запрос к Cloudflare с подменой fetch (тайм-аут, лимит, ошибки), пределы квот.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CloudError,
  ESTIMATE,
  MODELS,
  cfRun,
  commandMessages,
  dataUrlToBuffer,
  extractJsonObject,
  extractText,
  neuronsFromUsage,
  parseCommandAnswer,
  parseDetectAnswer,
  parseEditAnswer,
  sanitizeJpeg,
} from "../../lib/cloudAi/parse.js";
import { CLOUD_LIMITS, CLOUD_SAY, CONSENT_TEXT, boxPoint, clipMaskToBox, opsToSteps, outSize, targetToEnglish, unionMasks } from "../../lib/cloudAi/shared.js";
import { fakeCommandResult, fakeDetectResult, fakeEditResult } from "../../lib/cloudAi/fake.js";

const answer = { ops: [{ op: "adjust", exposure: 20, warmth: -10 }], say: "Ярче и холоднее" };

test("extractText: все формы ответа gpt-oss (response, choices, output[], output_text)", () => {
  const s = JSON.stringify(answer);
  assert.equal(extractText({ response: s }), s);
  assert.equal(extractText({ choices: [{ message: { role: "assistant", content: s } }] }), s);
  assert.equal(extractText({ output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "думаю" }] }, { type: "message", content: [{ type: "output_text", text: s }] }] }), s);
  assert.equal(extractText({ output_text: s }), s);
  assert.equal(extractText({ response: answer }), s);
  assert.equal(extractText(null), "");
  assert.equal(extractText({ foo: 1 }), "");
});

test("extractJsonObject: JSON внутри текста, ```json, скобки в строках, мусор", () => {
  assert.deepEqual(extractJsonObject("Вот:\n```json\n" + JSON.stringify(answer) + "\n```"), answer);
  assert.deepEqual(extractJsonObject('{"say":"скобка } внутри","ops":[]}'), { say: "скобка } внутри", ops: [] });
  assert.deepEqual(extractJsonObject('сначала {не json} потом {"ops":[]}'), { ops: [] });
  assert.equal(extractJsonObject("нет json"), null);
  assert.equal(extractJsonObject("[1,2]"), null);
  assert.equal(extractJsonObject('{"ops": ['), null);
});

test("parseCommandAnswer: только операции редактора, строгая схема", () => {
  const ok = parseCommandAnswer({ response: JSON.stringify({ ops: [{ op: "adjust", exposure: 95, contrast: -12.4 }, { op: "remove", target: "Car " }], say: "<b>Готово</b>" }) });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.ops[0], { op: "adjust", exposure: 60, contrast: -12 }); // обрезка до ±60
  assert.deepEqual(ok.ops[1], { op: "remove", target: "car" });
  assert.doesNotMatch(ok.say, /[<>]/);
  // Неизвестная операция, лишние поля, русская цель, слишком много операций, код в задании — отказ
  for (const bad of [
    { ops: [{ op: "delete_account" }] },
    { ops: [{ op: "auto", url: "https://evil.example" }] },
    { ops: [{ op: "remove", target: "машина" }] },
    { ops: [{ op: "remove", target: "car; drop table" }] },
    { ops: Array.from({ length: 5 }, () => ({ op: "auto" })) },
    { ops: [{ op: "creative", prompt: "небо" }] },
    { ops: [{ op: "adjust", exposure: "много" }] },
    { ops: [], say: "x", extra: 1 },
  ])
    assert.equal(parseCommandAnswer({ response: JSON.stringify(bad) }).ok, false, JSON.stringify(bad));
  assert.deepEqual(parseCommandAnswer({ response: "Не знаю" }), { ok: false, reason: "no_json" });
  assert.deepEqual(parseCommandAnswer({}), { ok: false, reason: "empty" });
  assert.equal(parseCommandAnswer({ response: '{"ops":[],"say":"Такого не умею"}' }).ok, true);
});

test("opsToSteps: ответ облака → те же шаги, что у словаря на устройстве", () => {
  const steps = opsToSteps([
    { op: "adjust", exposure: 20, warmth: -10, contrast: 0 },
    { op: "remove", target: "sun" },
    { op: "remove", target: "car" },
    { op: "find", target: "dog" },
    { op: "blur_background" },
    { op: "lighten_selection" },
    { op: "creative", prompt: "sunset sky" },
    { op: "undo" },
    { op: "unknown" },
  ]);
  assert.deepEqual(steps[0].deltas, { exposure: 20, warmth: -10 });
  assert.match(steps[0].say, /Яркость \+20, Тепло -10/);
  assert.deepEqual(steps.slice(1).map((s) => s.kind), ["remove", "remove", "find", "blurBackground", "maskTone", "creative", "undo"]);
  assert.equal(steps[1].target, "sun"); // солнце — эвристика на устройстве, без облака
  assert.equal(steps[2].en, "car");
  assert.equal(steps[5].dir, 1);
  assert.equal(opsToSteps(null).length, 0);
});

test("targetToEnglish: словарь корней, латиница как есть, без ложных совпадений", () => {
  const cases = { машину: "car", "красную машину": "car", собаку: "dog", пса: "dog", людей: "person", человека: "person", кота: "cat", кошку: "cat", провода: "power lines", мяч: "ball", "мусорный бак": "trash", tree: "tree", "Power Lines": "power lines", велосипед: "bicycle", птиц: "bird" };
  for (const [ru, en] of Object.entries(cases)) assert.equal(targetToEnglish(ru), en, ru);
  for (const none of ["котлету", "радость", "", "x".repeat(80)]) assert.equal(targetToEnglish(none), null, none);
  assert.equal(targetToEnglish("<script>"), "script"); // разметка вырезается, остаются только буквы
});

test("parseDetectAnswer: доли и пиксели, мелкие и во весь кадр отброшены, крупные первыми", () => {
  const r = parseDetectAnswer({ objects: [{ x_min: 0.1, y_min: 0.1, x_max: 0.2, y_max: 0.2 }, { x_min: 0.3, y_min: 0.3, x_max: 0.8, y_max: 0.9 }, { x_min: 0.5, y_min: 0.5, x_max: 0.505, y_max: 0.6 }, { x_min: 0, y_min: 0, x_max: 1, y_max: 1 }] }, 768, 512);
  assert.equal(r.ok, true);
  assert.equal(r.boxes.length, 2);
  assert.deepEqual(r.boxes[0], { x0: 0.3, y0: 0.3, x1: 0.8, y1: 0.9 });
  const px = parseDetectAnswer({ objects: [{ x_min: 384, y_min: 128, x_max: 768, y_max: 512 }] }, 768, 512);
  assert.deepEqual(px.boxes[0], { x0: 0.5, y0: 0.25, x1: 1, y1: 1 });
  assert.deepEqual(parseDetectAnswer({ objects: [] }, 10, 10), { ok: true, boxes: [] });
  assert.equal(parseDetectAnswer({ objects: [{ x_min: "a" }] }, 10, 10).ok, false);
  assert.equal(parseDetectAnswer(fakeDetectResult(), 768, 512).boxes.length, 1);
});

test("parseEditAnswer: PNG/JPEG из base64, остальное — отказ", () => {
  const r = parseEditAnswer(fakeEditResult());
  assert.equal(r.ok, true);
  assert.equal(r.mime, "image/png");
  assert.equal(parseEditAnswer({ image: Buffer.from("GIF89a" + "x".repeat(100)).toString("base64") }).ok, false);
  assert.equal(parseEditAnswer({}).ok, false);
});

// Синтетический JPEG: JFIF, EXIF с «GPS», SOF0 640×480, SOS
function jpegWithExif(w = 640, h = 480) {
  const seg = (marker, payload) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    seg(0xe1, Buffer.from("Exif\0\0GPS-53.90N-27.56E", "latin1")),
    seg(0xfe, Buffer.from("comment: name.jpg", "latin1")),
    seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    Buffer.from([1, 2, 3, 0xff, 0xd9]),
  ]);
}

test("sanitizeJpeg: EXIF, GPS и комментарии вырезаны, размер прочитан; не JPEG — null", () => {
  const src = jpegWithExif();
  const r = sanitizeJpeg(src);
  assert.equal(r.width, 640);
  assert.equal(r.height, 480);
  const text = r.buf.toString("latin1");
  assert.doesNotMatch(text, /Exif|GPS|name\.jpg/);
  assert.match(text, /JFIF/);
  assert.ok(r.buf.length < src.length);
  assert.equal(sanitizeJpeg(Buffer.from("\x89PNG....", "latin1")), null);
  assert.equal(sanitizeJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff])), null); // обрыв
  const url = "data:image/jpeg;base64," + src.toString("base64");
  assert.deepEqual(dataUrlToBuffer(url, 10_000), src);
  assert.equal(dataUrlToBuffer(url, 10), null);
  assert.equal(dataUrlToBuffer("data:image/png;base64,AAAA", 10_000), null);
});

// Подмена fetch: запоминает запрос, отвечает заданным
function stubFetch(status, payload, { throwName } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (throwName) throw Object.assign(new Error(throwName), { name: throwName });
    return new Response(typeof payload === "string" ? payload : JSON.stringify(payload), { status });
  };
  fn.calls = calls;
  return fn;
}

test("cfRun: адрес модели, ключ только в заголовке, result из обёртки", async () => {
  const f = stubFetch(200, { success: true, result: fakeCommandResult("сделай как в старом кино"), errors: [] });
  const res = await cfRun({ account: "acc", token: "TOKEN-123", model: MODELS.command, body: { messages: commandMessages("как в кино") }, fetchImpl: f });
  assert.equal(f.calls[0].url, "https://api.cloudflare.com/client/v4/accounts/acc/ai/run/@cf/openai/gpt-oss-120b");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer TOKEN-123");
  assert.doesNotMatch(f.calls[0].init.body, /TOKEN-123/);
  assert.ok(f.calls[0].init.signal instanceof AbortSignal);
  const parsed = parseCommandAnswer(res);
  assert.equal(parsed.ok, true);
  assert.deepEqual(opsToSteps(parsed.ops)[0].deltas, { saturation: -30, contrast: 15, warmth: 10 });
});

test("cfRun: лимит Cloudflare, ошибка, нет сети, тайм-аут → понятные коды", async () => {
  const code = async (f) => {
    try {
      await cfRun({ account: "a", token: "t", model: MODELS.detect, body: {}, fetchImpl: f });
      return "ok";
    } catch (e) {
      assert.ok(e instanceof CloudError);
      return e.code;
    }
  };
  assert.equal(await code(stubFetch(429, { success: false, errors: [{ code: 3036, message: "Too many" }] })), "cf_quota");
  assert.equal(await code(stubFetch(400, { success: false, errors: [{ code: 4006, message: "you have used up your daily free allocation of 10,000 neurons" }] })), "cf_quota");
  assert.equal(await code(stubFetch(500, "<html>oops</html>")), "cf_http");
  assert.equal(await code(stubFetch(200, { success: false, errors: [{ code: 5000, message: "Internal" }] })), "cf_http");
  assert.equal(await code(stubFetch(0, null, { throwName: "TypeError" })), "cf_network");
  assert.equal(await code(stubFetch(0, null, { throwName: "TimeoutError" })), "cf_timeout");
});

test("нейроны: расчёт по токенам и оценки укладываются в дневной бюджет", () => {
  assert.equal(neuronsFromUsage(MODELS.command, { prompt_tokens: 1_000_000, completion_tokens: 0 }), 31_818);
  assert.equal(neuronsFromUsage(MODELS.command, { prompt_tokens: 420, completion_tokens: 380 }), 40);
  assert.equal(neuronsFromUsage(MODELS.detect, { input_tokens: 760, output_tokens: 24 }), 23);
  assert.equal(neuronsFromUsage(MODELS.command, null), null);
  assert.equal(neuronsFromUsage(MODELS.edit, { input_tokens: 1, output_tokens: 1 }), null);
  // 20 правок в сутки на пользователя, бюджет 8 000 из бесплатных 10 000 нейронов
  assert.equal(CLOUD_LIMITS.perUserDay, 20);
  assert.ok(CLOUD_LIMITS.budgetDay <= 8000);
  assert.ok(CLOUD_LIMITS.perUserDay * (ESTIMATE.detect + ESTIMATE.translate) < CLOUD_LIMITS.budgetDay);
  assert.equal(CONSENT_TEXT, "Фото отправится в Cloudflare для обработки и не сохраняется.");
  assert.match(CLOUD_SAY.quota, /Лимит облачных правок на сегодня исчерпан/);
});

test("маска по рамке: вне рамки нули, объединение, точка в центре, размер вырезки FLUX", () => {
  const w = 10;
  const h = 10;
  const bits = new Uint8Array(w * h).fill(1);
  const clipped = clipMaskToBox(bits, w, h, { x0: 0.2, y0: 0.2, x1: 0.5, y1: 0.5 }, 0);
  assert.equal(clipped.reduce((a, b) => a + b, 0), 9);
  assert.equal(clipped[0], 0);
  assert.equal(clipped[3 * w + 3], 1);
  const u = unionMasks(clipped, clipMaskToBox(bits, w, h, { x0: 0.6, y0: 0.6, x1: 0.8, y1: 0.8 }, 0));
  assert.equal(u.reduce((a, b) => a + b, 0), 13);
  const p = boxPoint({ x0: 0.2, y0: 0.4, x1: 0.6, y1: 0.8 }, 100, 50);
  assert.ok(Math.abs(p.x - 40) < 1e-9 && Math.abs(p.y - 30) < 1e-9 && p.add === true);
  assert.deepEqual(outSize(512, 384), { width: 512, height: 384 });
  assert.deepEqual(outSize(100, 400), { width: 256, height: 512 });
});
