// N2 · сезон оформления: GET /api/v1/season (публично, короткий кэш), PUT /api/v1/admin/season (только admin, журнал).
// Клиент и модератор — 403, гость — 401, неверное значение — 400. После теста сезон возвращается к исходному.
// Тестовые пользователи e2e-…@example.com удаляются. Запуск: BASE_URL=http://127.0.0.1:<порт> npm run test:api.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const guest = new Client("гость");
const SEASONS = ["none", "autumn", "blackfriday", "newyear"];
let U; // клиент
let M; // модератор
let A; // админ
let original = "autumn";

before(async () => {
  const { data } = await admin.from("site_season").select("season").eq("id", true).maybeSingle();
  original = data?.season || "autumn";
  [U, M, A] = await Promise.all([
    createTestUser(admin, ["client"], "season"),
    createTestUser(admin, ["moderator"], "seasonmod"),
    createTestUser(admin, ["admin"], "seasonadm"),
  ]);
});

after(async () => {
  // Вернуть сезон, как был до теста (через API — смена тоже попадает в журнал)
  if (A) await A.client.req("/api/v1/admin/season", { method: "PUT", body: { season: original } });
  await Promise.all([U, M, A].map((x) => deleteTestUser(admin, x)));
});

const put = (who, body) => who.req("/api/v1/admin/season", { method: "PUT", body });

test("GET /api/v1/season: публично, одно из 4 значений, короткий публичный кэш", async () => {
  const r = await guest.req("/api/v1/season");
  assert.equal(r.status, 200, r.text);
  assert.ok(SEASONS.includes(r.json.season), r.text);
  assert.deepEqual(Object.keys(r.json), ["season"]);
  const cc = r.headers.get("cache-control") || "";
  assert.match(cc, /public/);
  assert.match(cc, /max-age=5\b/);
  // вошедший пользователь: ответ без общего кэша (к нему proxy.js может добавить обновлённые cookies сессии)
  const mine = await U.client.req("/api/v1/season");
  assert.equal(mine.status, 200);
  assert.equal(mine.json.season, r.json.season);
  assert.match(mine.headers.get("cache-control") || "", /private, no-store/);
  // смена сезона только через админку: у публичного адреса нет PUT/POST
  assert.equal((await guest.req("/api/v1/season", { method: "PUT", body: { season: "none" } })).status, 405);
  assert.equal((await guest.req("/api/v1/season", { method: "POST", body: { season: "none" } })).status, 405);
});

test("смена сезона: гость 401, клиент и модератор 403 (и чтение настроек админки), отказ — в журнале", async () => {
  assert.equal((await put(guest, { season: "none" })).status, 401);
  assert.equal((await guest.req("/api/v1/admin/season")).status, 401);
  for (const who of [U, M]) {
    assert.equal((await put(who.client, { season: "none" })).status, 403, who.email);
    assert.equal((await who.client.req("/api/v1/admin/season")).status, 403, who.email);
  }
  // Страница «Сезон» — тоже только админу
  assert.equal((await M.client.req("/admin/season")).status, 403);
  assert.equal((await U.client.req("/admin/season")).status, 403);
  const { data: denied } = await admin.from("audit_log").select("action, result, object_id").eq("user_id", M.id).eq("action", "access.denied").limit(20);
  assert.ok(denied?.some((d) => d.object_id === "/api/v1/admin/season" && d.result === "denied"), "отказ модератору записан в журнал");
  // сезон не изменился
  assert.equal((await guest.req("/api/v1/season")).json.season, original);
});

test("неверное значение, лишнее поле, пустое тело — 400 с понятным текстом", async () => {
  for (const body of [{ season: "spring" }, { season: "AUTUMN" }, { season: "" }, { season: 1 }, {}, { season: "autumn", extra: 1 }]) {
    const r = await put(A.client, body);
    assert.equal(r.status, 400, JSON.stringify(body) + " → " + r.text);
    assert.equal(r.json.ok, false);
    assert.match(r.json.error.message, /^Проверьте данные/);
  }
  const raw = await A.client.req("/api/v1/admin/season", { method: "PUT", raw: "season=autumn", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(raw.status, 400);
});

test("админ меняет сезон: ответ, публичное чтение видит новое значение сразу, запись в журнале «от → к»", async () => {
  const target = original === "newyear" ? "blackfriday" : "newyear";
  const r = await put(A.client, { season: target });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { ok: true, season: target, previous: original });
  assert.equal((await guest.req("/api/v1/season")).json.season, target);
  // главная сразу отдаётся с новым сезоном (атрибут на <html> ставит сервер — без мигания)
  const html = await guest.req("/");
  assert.match(html.text, new RegExp(`<html[^>]*data-season="${target}"`));
  const info = await A.client.req("/api/v1/admin/season");
  assert.equal(info.status, 200, info.text);
  assert.equal(info.json.season, target);
  assert.equal(info.json.updatedBy, A.email);
  assert.ok(Date.now() - new Date(info.json.updatedAt).getTime() < 120_000);
  const { data: log } = await admin.from("audit_log").select("action, result, object_type, object_id, details, role").eq("user_id", A.id).eq("action", "admin.season_set").order("at", { ascending: false }).limit(1);
  assert.equal(log?.length, 1, "есть запись в журнале");
  assert.equal(log[0].result, "success");
  assert.equal(log[0].role, "admin");
  assert.equal(log[0].object_type, "season");
  assert.equal(log[0].object_id, target);
  assert.equal(log[0].details.from, original);
  assert.equal(log[0].details.to, target);
  // «Без сезона» — тоже допустимое значение
  const off = await put(A.client, { season: "none" });
  assert.equal(off.status, 200, off.text);
  assert.equal((await guest.req("/api/v1/season")).json.season, "none");
  assert.match((await guest.req("/")).text, /<html[^>]*data-season="none"/);
});

test("строка сезона в базе: читать может гость (RLS), менять — нет", async () => {
  const { supabaseAnon } = await import("../helpers/client.mjs");
  const anon = supabaseAnon();
  const { data, error } = await anon.from("site_season").select("season").eq("id", true).maybeSingle();
  assert.equal(error, null);
  assert.ok(SEASONS.includes(data?.season));
  const upd = await anon.from("site_season").update({ season: "blackfriday" }).eq("id", true).select();
  // без политики на изменение строка не меняется (ошибка прав или 0 строк)
  assert.ok(upd.error || (upd.data || []).length === 0, "гость не может менять сезон");
  const ins = await anon.from("site_season").upsert({ id: true, season: "blackfriday" }).select();
  assert.ok(ins.error, "гость не может вставить строку");
  const { data: after1 } = await admin.from("site_season").select("season").eq("id", true).maybeSingle();
  assert.notEqual(after1.season, "blackfriday");
});
