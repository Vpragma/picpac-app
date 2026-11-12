// N10: лента сотрудника без шума. Уведомления по заказам автотестов помечены is_test (их видит только тестовый
// сотрудник), шаги симулятора ERP — одна сводка за день вместо уведомления на каждый шаг (миграция 0018).
// Запуск: npm run test:api. Создаёт пользователей e2e-…@example.com и удаляет их вместе с заказами.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-noise-${randomUUID().slice(0, 8)}`;
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
let C, ADM;
const s = {};

// Последняя сводка симулятора по тестовым заказам (одна строка на день по Минску)
const testDigest = async () =>
  (await admin.from("staff_notifications").select("id, dedupe_key, title, body, is_test, repeat_count, order_id, link").like("dedupe_key", "erp-sim:test:%").order("created_at", { ascending: false }).limit(1)).data?.[0] || null;

before(async () => {
  [C, ADM] = await Promise.all([createTestUser(admin, ["client"], "noisec"), createTestUser(admin, ["admin"], "noiseadm")]);
  const p = await C.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Шум", options: { size: "20x20", pages: 20 } } });
  assert.equal(p.status, 201, p.text);
  const u = await C.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  assert.equal(u.status, 200, u.text);
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok, "файл загружен");
  const ph = await C.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(ph.status, 201, ph.text);
  await C.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  const o = await C.client.req("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": `${RUN}-o1` },
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 1" } }, recipient: { name: "Тест Шумов", phone: "+375 29 000-00-01" } },
  });
  assert.equal(o.status, 201, o.text);
  s.order = o.json.order;
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  for (const u of [C, ADM]) await deleteTestUser(admin, u);
});

test("новый заказ автотеста: уведомление сотрудникам есть, но помечено is_test", async () => {
  const { data } = await admin.from("staff_notifications").select("kind, is_test").eq("order_id", s.order.id);
  assert.ok(data.some((n) => n.kind === "order_new"), "«Новый заказ» создан");
  assert.ok(data.every((n) => n.is_test === true), "все уведомления по заказу автотеста помечены is_test");
});

test("симулятор ERP: шаги до «Завершён» — одна сводка за день, а не уведомление на каждый шаг", async () => {
  const pay = await C.client.req(`/api/v1/orders/${s.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } });
  assert.equal(pay.status, 200, pay.text);
  const before = await testDigest();
  // Как будто с оплаты прошло 10 минут: при чтении заказа симулятор догоняет все шаги
  const past = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin.from("orders").update({ status_changed_at: past, paid_at: past }).eq("id", s.order.id);
  const r = await C.client.req(`/api/v1/orders/${s.order.id}`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.status, "done");

  const { data: rows } = await admin.from("staff_notifications").select("kind, dedupe_key").eq("order_id", s.order.id);
  assert.deepEqual(
    rows.map((n) => n.kind),
    ["order_new"],
    "по шагам симулятора отдельных уведомлений нет: " + rows.map((n) => n.dedupe_key).join(", "),
  );
  const d = await testDigest();
  assert.ok(d, "сводка симулятора создана");
  assert.equal(d.is_test, true, "сводка по тестовым заказам скрыта от настоящего админа");
  assert.equal(d.order_id, null, "сводка не привязана к одному заказу");
  assert.equal(d.link, "/admin");
  assert.match(d.title, /^Симулятор ERP · сводка за \d\d\.\d\d$/);
  assert.match(d.body, /^Смен статуса: \d+\. Последняя: /);
  // 4 смены статуса: Модерация, Производство, Передан в доставку, Завершён (другие дорожки могут добавить свои)
  if (before && before.dedupe_key === d.dedupe_key) assert.ok(d.repeat_count >= before.repeat_count + 4, `счётчик ${before.repeat_count} → ${d.repeat_count}`);
  else assert.ok(d.repeat_count >= 1);
});

test("лента тестового админа: видит «Новый заказ» автотеста и счётчик сводки; клиент → 403", async () => {
  const r = await ADM.client.req("/api/v1/admin/notifications");
  assert.equal(r.status, 200, r.text);
  assert.ok(
    r.json.items.some((n) => n.orderId === s.order.id && n.kind === "order_new"),
    "тестовый сотрудник видит уведомления автотестов",
  );
  assert.ok(r.json.items.every((n) => Number.isInteger(n.count) && n.count >= 1), "у каждой строки есть счётчик");
  assert.equal((await C.client.req("/api/v1/admin/notifications")).status, 403);
});
