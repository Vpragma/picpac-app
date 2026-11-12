// D6 (SEC-20): облачный ИИ — без входа 401, без согласия отказ, строгая схема, квота исчерпана → 429,
// чужой сайт → 403, журнал без текста команды, функция квоты в базе. Облако в этих проверках не вызывается.
// Если сервер запущен с AI_CLOUD_FAKE=1 — ещё и полный путь с подменой ответа Cloudflare.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
let user;
const today = () => new Date().toISOString().slice(0, 10);

// Синтетический JPEG (только заголовки) нужного размера, с EXIF
function jpeg(w, h) {
  const seg = (marker, payload) => Buffer.concat([Buffer.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe1, Buffer.from("Exif\0\0GPS-53.90N-27.56E" + "x".repeat(80), "latin1")),
    seg(0xc0, Buffer.from([8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])),
    seg(0xda, Buffer.from([3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0])),
    Buffer.from([1, 2, 3, 0xff, 0xd9]),
  ]);
  return "data:image/jpeg;base64," + buf.toString("base64");
}

before(async () => {
  user = await createTestUser(admin, ["client"], "cloud");
});

after(async () => {
  await deleteTestUser(admin, user);
});

test("без входа — 401 на всех маршрутах облачного ИИ", async () => {
  const guest = new Client("guest");
  assert.equal((await guest.req("/api/v1/ai/cloud")).status, 401);
  assert.equal((await guest.req("/api/v1/ai/consent", { method: "POST", body: { accept: true } })).status, 401);
  assert.equal((await guest.req("/api/v1/ai/command", { method: "POST", body: { text: "как в старом кино" } })).status, 401);
  assert.equal((await guest.req("/api/v1/ai/detect", { method: "POST", body: { image: jpeg(640, 480), target: "машину" } })).status, 401);
  // творческих правок FLUX больше нет (решение 12.11) — такого адреса API нет
  const r = await guest.req("/api/v1/ai/edit", { method: "POST", body: { image: jpeg(256, 256), prompt: "небо на закат" } });
  assert.equal(r.status, 404);
});

test("вошёл, но без согласия — 403 ai_consent_required, облако не вызывается, отказ в журнале", async () => {
  const s = await user.client.req("/api/v1/ai/cloud");
  assert.equal(s.status, 200);
  assert.equal(s.json.consent, false);
  assert.equal(s.json.limit, 20);
  assert.equal(s.json.consentText, "Фото отправится в Cloudflare для обработки и не сохраняется.");
  assert.doesNotMatch(s.text, /CLOUDFLARE|Bearer|api\.cloudflare\.com/);
  const r = await user.client.req("/api/v1/ai/command", { method: "POST", body: { text: "сделай как в старом кино" } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "ai_consent_required");
  assert.match(r.json.error.message, /согласие/i);
  const d = await user.client.req("/api/v1/ai/detect", { method: "POST", body: { image: jpeg(640, 480), target: "машину" } });
  assert.equal(d.status, 403);
  const { data: rows } = await admin.from("audit_log").select("action,result,details").eq("user_id", user.id).eq("action", "ai.cloud_command");
  assert.ok(rows.some((x) => x.result === "denied" && x.details.reason === "no_consent"));
  assert.ok(rows.every((x) => !JSON.stringify(x.details).includes("кино")), "текст команды не пишется в журнал");
});

test("строгая схема и источник: лишние поля, пустой и длинный текст, PNG, большой кадр, чужой сайт", async () => {
  const c = user.client;
  assert.equal((await c.req("/api/v1/ai/command", { method: "POST", body: { text: "ярче", model: "@cf/other" } })).status, 400);
  assert.equal((await c.req("/api/v1/ai/command", { method: "POST", body: { text: "   " } })).status, 400);
  assert.equal((await c.req("/api/v1/ai/command", { method: "POST", body: { text: "я".repeat(301) } })).status, 400);
  assert.equal((await c.req("/api/v1/ai/consent", { method: "POST", body: { accept: false } })).status, 400);
  const png = await c.req("/api/v1/ai/detect", { method: "POST", body: { image: "data:image/png;base64," + "A".repeat(200), target: "car" } });
  assert.equal(png.status, 400);
  assert.match(png.json.error.message, /JPEG/);
  const huge = await c.req("/api/v1/ai/detect", { method: "POST", body: { image: jpeg(2000, 1000), target: "car" } });
  assert.equal(huge.status, 400);
  assert.match(huge.json.error.message, /1024/);
  const evil = await c.req("/api/v1/ai/command", { method: "POST", body: { text: "ярче" }, headers: { origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
});

test("согласие: дать, увидеть в статусе, журнал", async () => {
  const r = await user.client.req("/api/v1/ai/consent", { method: "POST", body: { accept: true } });
  assert.equal(r.status, 200);
  assert.equal(r.json.consent, true);
  const s = await user.client.req("/api/v1/ai/cloud");
  assert.equal(s.json.consent, true);
  const { data } = await admin.from("audit_log").select("result").eq("user_id", user.id).eq("action", "ai.cloud_consent");
  assert.ok(data.some((x) => x.result === "success"));
});

test("квота исчерпана (20 правок за сутки) → 429 с понятным текстом и Retry-After, облако не вызывается", async () => {
  const { error } = await admin.from("ai_cloud_usage").upsert({ day: today(), user_id: user.id, calls: 20, neurons: 0 }, { onConflict: "day,user_id" });
  assert.equal(error, null);
  const r = await user.client.req("/api/v1/ai/command", { method: "POST", body: { text: "сделай как в старом кино" } });
  assert.equal(r.status, 429);
  assert.equal(r.json.error.code, "ai_quota_exhausted");
  assert.equal(r.json.error.message, "Лимит облачных правок на сегодня исчерпан, правки на телефоне работают.");
  assert.ok(Number(r.headers.get("retry-after")) >= 60);
  const d = await user.client.req("/api/v1/ai/detect", { method: "POST", body: { image: jpeg(640, 480), target: "машину" } });
  assert.equal(d.status, 429);
  const s = await user.client.req("/api/v1/ai/cloud");
  assert.equal(s.json.left, 0);
  const { data } = await admin.from("audit_log").select("details").eq("user_id", user.id).eq("action", "ai.cloud_command").eq("result", "denied");
  assert.ok(data.some((x) => x.details.reason === "quota"));
  await admin.from("ai_cloud_usage").delete().eq("user_id", user.id);
});

test("функция квоты в базе: общий бюджет нейронов исчерпан → budget; возврат правки при сбое облака", async () => {
  const over = await admin.rpc("ai_cloud_reserve", { _user: user.id, _user_limit: 20, _budget: 0, _estimate: 1 });
  assert.equal(over.error, null);
  assert.equal(over.data.ok, false);
  assert.equal(over.data.reason, "budget");
  const ok = await admin.rpc("ai_cloud_reserve", { _user: user.id, _user_limit: 20, _budget: 1_000_000_000, _estimate: 0 });
  assert.equal(ok.data.ok, true);
  assert.equal(ok.data.used, 1);
  await admin.rpc("ai_cloud_settle", { _user: user.id, _day: ok.data.day, _delta: 0, _refund: true });
  const { data } = await admin.from("ai_cloud_usage").select("calls").eq("user_id", user.id).eq("day", ok.data.day).single();
  assert.equal(data.calls, 0);
  // Клиенту функции квоты недоступны
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const denied = await anon.rpc("ai_cloud_reserve", { _user: user.id, _user_limit: 1000, _budget: 1000, _estimate: 0 });
  assert.ok(denied.error, "аноним не может занимать квоту");
  const read = await anon.from("ai_cloud_usage").select("*");
  assert.ok(read.error || read.data.length === 0);
});

test("с подменой облака (AI_CLOUD_FAKE=1): команда и поиск — шаги редактора и рамки", async (t) => {
  const s = await user.client.req("/api/v1/ai/cloud");
  if (!s.json.fake) return t.skip("сервер запущен без AI_CLOUD_FAKE=1 — живое облако в тестах не вызываем");
  const c = await user.client.req("/api/v1/ai/command", { method: "POST", body: { text: "сделай как в старом кино" } });
  assert.equal(c.status, 200);
  assert.deepEqual(c.json.ops[0], { op: "adjust", saturation: -30, contrast: 15, warmth: 10 });
  const d = await user.client.req("/api/v1/ai/detect", { method: "POST", body: { image: jpeg(640, 480), target: "машину" } });
  assert.equal(d.status, 200);
  assert.equal(d.json.target, "car");
  assert.equal(d.json.boxes.length, 1);
  const { data } = await admin.from("ai_cloud_usage").select("calls,neurons").eq("user_id", user.id).eq("day", today()).single();
  assert.equal(data.calls, 2);
  assert.ok(data.neurons > 0);
  const { data: log } = await admin.from("audit_log").select("action,details").eq("user_id", user.id).eq("result", "success").like("action", "ai.cloud_%");
  assert.ok(log.some((x) => x.action === "ai.cloud_detect" && x.details.model === "@cf/moondream/moondream3.1-9B-A2B" && x.details.bytes > 0));
  assert.ok(log.every((x) => !JSON.stringify(x.details).match(/base64|кино|sunset/)), "в журнале нет фото и текста");
});

test("отзыв согласия → снова 403", async () => {
  const r = await user.client.req("/api/v1/ai/consent", { method: "DELETE" });
  assert.equal(r.status, 200);
  assert.equal(r.json.consent, false);
  const c = await user.client.req("/api/v1/ai/command", { method: "POST", body: { text: "как в кино" } });
  assert.equal(c.status, 403);
});
