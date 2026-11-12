// N6: лимиты частоты на чувствительных маршрутах — заказ (10 в минуту) и обращения (20 в час) на пользователя.
// Промокод и события проверяют api.test и events.test. Вход и регистрацию считают по IP общего сервера —
// их здесь не «выжигаем», чтобы не заблокировать параллельные проверки (лимиты описаны в docs/security.md).
// Запуск: npm run test:api. Пользователи e2e-…@example.com удаляются вместе с заказами и обращениями.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-lim-${randomUUID().slice(0, 8)}`;
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const body = { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 1" } }, recipient: { name: "Тест Лимитов", phone: "+375 29 000-00-02" } };
let O, I;
const s = {};

before(async () => {
  [O, I] = await Promise.all([createTestUser(admin, ["client"], "limo"), createTestUser(admin, ["client"], "limi")]);
  // Для обращений нужен свой заказ
  const p = await I.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Лимиты", options: { size: "20x20", pages: 20 } } });
  assert.equal(p.status, 201, p.text);
  const u = await I.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok, "файл загружен");
  const ph = await I.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(ph.status, 201, ph.text);
  await I.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  const o = await I.client.req("/api/v1/orders", { method: "POST", headers: { "idempotency-key": `${RUN}-o1` }, body });
  assert.equal(o.status, 201, o.text);
  s.order = o.json.order;
  // Симулятор ERP этот заказ не двигает
  await admin.from("orders").update({ is_demo: false }).eq("id", s.order.id);
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  for (const u of [O, I]) {
    if (!u) continue;
    await admin.from("orders").delete().eq("user_id", u.id);
    await deleteTestUser(admin, u);
  }
});

test("лимит: больше 10 попыток оформить заказ за минуту → 429 с Retry-After", async () => {
  const codes = [];
  let limited = null;
  for (let i = 0; i < 12 && !limited; i++) {
    const r = await O.client.req("/api/v1/orders", { method: "POST", headers: { "idempotency-key": `${RUN}-burst-${i}` }, body });
    codes.push(r.status);
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, "нет ответа 429: " + codes.join(","));
  assert.ok(codes.slice(0, 10).every((c) => c === 409), "первые 10 — обычный ответ (пустая корзина): " + codes.join(","));
  assert.equal(limited.json.error.code, "rate_limited");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
});

test("лимит: больше 20 обращений за час → 429 с Retry-After", async () => {
  const codes = [];
  let limited = null;
  for (let i = 0; i < 22 && !limited; i++) {
    const r = await I.client.req(`/api/v1/orders/${s.order.id}/interactions`, {
      method: "POST",
      body: { topic: "Другой вопрос", kind: "support", message: `Проверка лимита ${i + 1}` },
    });
    codes.push(r.status);
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, "нет ответа 429: " + codes.join(","));
  assert.equal(codes.filter((c) => c === 201).length, 20, "ровно 20 обращений прошли: " + codes.join(","));
  assert.equal(limited.json.error.code, "rate_limited");
  assert.equal(limited.headers.get("retry-after"), "3600");
});
