// API-тесты статистики (S10): POST /api/v1/events без персональных данных и с лимитом частоты,
// GET /api/v1/admin/stats только для админа. Тестовые пользователи e2e-…@example.com удаляются после тестов.
// Запуск: npm run test:api (сервер — BASE_URL, по умолчанию http://localhost:3000)
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const guest = new Client("гость");
const sids = [];
const newSid = () => {
  const s = randomBytes(12).toString("hex");
  sids.push(s);
  return s;
};
let U; // клиент
let A; // админ

before(async () => {
  [U, A] = await Promise.all([createTestUser(admin, ["client"], "ev"), createTestUser(admin, ["admin"], "evadm")]);
});

after(async () => {
  if (sids.length) await admin.from("analytics_events").delete().in("session_id", sids);
  await Promise.all([deleteTestUser(admin, U), deleteTestUser(admin, A)]);
});

test("events: пачка событий гостя принимается (202), без хеша пользователя", async () => {
  const sid = newSid();
  const r = await guest.req("/api/v1/events", {
    method: "POST",
    body: { sid, events: [{ type: "product_view", props: { product: "pages-book" } }, { type: "editor_step", step: "photos", durationMs: 42000 }] },
  });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.accepted, 2);
  const { data } = await admin.from("analytics_events").select("*").eq("session_id", sid);
  assert.equal(data.length, 2);
  assert.ok(data.every((e) => e.user_hash === null && !e.is_synthetic));
  assert.equal(data.find((e) => e.type === "editor_step").duration_ms, 42000);
});

test("events: у вошедшего — только хеш с солью, ни id, ни почты в строке", async () => {
  const sid = newSid();
  const r = await U.client.req("/api/v1/events", { method: "POST", body: { sid, events: [{ type: "cart_add", props: { product: "photo" } }] } });
  assert.equal(r.status, 202, r.text);
  const { data } = await admin.from("analytics_events").select("*").eq("session_id", sid);
  assert.equal(data.length, 1);
  const row = JSON.stringify(data[0]);
  assert.match(data[0].user_hash, /^[a-f0-9]{64}$/);
  assert.ok(!row.includes(U.id), "в событии нет id пользователя");
  assert.ok(!row.includes(U.email) && !row.includes("@"), "в событии нет почты");
});

test("events: персональные данные и чужие поля отклоняются (400)", async () => {
  const sid = newSid();
  const bad = [
    { sid, events: [{ type: "product_view", props: { email: "someone@example.com" } }] },
    { sid, events: [{ type: "product_view", props: { product: "Иван Петров" } }] },
    { sid, events: [{ type: "product_view", name: "Иван" }] },
    { sid, events: [{ type: "payment_test" }] }, // оплату пишет только сервер
    { sid, events: [{ type: "unknown" }] },
    { sid: "user@example.com", events: [{ type: "product_view" }] },
    { sid, events: [] },
    { sid, events: Array.from({ length: 51 }, () => ({ type: "product_view" })) },
  ];
  for (const body of bad) {
    const r = await guest.req("/api/v1/events", { method: "POST", body });
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80));
  }
  const { data } = await admin.from("analytics_events").select("id").eq("session_id", sid);
  assert.equal(data.length, 0);
});

test("events: запрос с чужого сайта → 403", async () => {
  const r = await guest.req("/api/v1/events", { method: "POST", headers: { origin: "https://evil.example" }, body: { sid: newSid(), events: [{ type: "product_view" }] } });
  assert.equal(r.status, 403);
});

test("events: лимит частоты — больше 30 пачек в минуту на сеанс → 429", async () => {
  const sid = newSid();
  let limited = null;
  for (let attempt = 0; attempt < 2 && !limited; attempt++) {
    const burst = await Promise.all(Array.from({ length: 36 }, () => guest.req("/api/v1/events", { method: "POST", body: { sid, events: [{ type: "product_view" }] } })));
    limited = burst.find((r) => r.status === 429) || null;
  }
  assert.ok(limited, "нет ответа 429");
  assert.equal(limited.json.error.code, "rate_limited");
  // Другой сеанс не страдает
  const other = await guest.req("/api/v1/events", { method: "POST", body: { sid: newSid(), events: [{ type: "product_view" }] } });
  assert.equal(other.status, 202);
});

test("admin/stats: гость 401, клиент 403, админ — воронка, плитки и подпись источника", async () => {
  assert.equal((await guest.req("/api/v1/admin/stats")).status, 401);
  assert.equal((await U.client.req("/api/v1/admin/stats")).status, 403);
  const r = await A.client.req("/api/v1/admin/stats?days=30&source=all");
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.days, 30);
  assert.ok(["демо-данные", "реальные"].includes(r.json.label));
  assert.equal(r.json.funnel.steps.length, 5);
  assert.equal(r.json.funnel.steps[4].key, "payment_test");
  for (const k of ["ordersToday", "inWork", "overdue", "onModeration", "unanswered", "revenueKop"]) assert.equal(typeof r.json.tiles[k], "number", k);
  assert.equal(r.json.steps.rows.length, 4);
  const real = await A.client.req("/api/v1/admin/stats?days=7&source=real");
  assert.equal(real.status, 200);
  assert.equal(real.json.synthetic.events, 0, "«только реальные» без синтетики");
  assert.equal(real.json.label, "реальные");
});
