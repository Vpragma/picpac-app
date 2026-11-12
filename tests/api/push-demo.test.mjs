// D9: «Демо пушей» в админке и «Проверить уведомления» в профиле — права, шаблоны, частота.
// Удаление мёртвой подписки (404/410) — в unit-тесте tests/unit/push-demo.test.mjs (без сети).
// Тестовые пользователи e2e-…@example.com удаляются после тестов. Запуск: npm run test:api (BASE_URL — сервер).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const guest = new Client("гость");
let U; // клиент
let M; // модератор
let A; // админ
let A2; // второй админ (у каждого свой лимит частоты)

before(async () => {
  [U, M, A, A2] = await Promise.all([
    createTestUser(admin, ["client"], "pdemo"),
    createTestUser(admin, ["moderator"], "pdemomod"),
    createTestUser(admin, ["admin"], "pdemoadm"),
    createTestUser(admin, ["admin"], "pdemoadm2"),
  ]);
});

after(async () => {
  await Promise.all([U, M, A, A2].map((x) => deleteTestUser(admin, x)));
});

const demo = (who, body) => who.client.req("/api/v1/admin/push-demo", { method: "POST", body });

test("демо пушей: гость 401, клиент и модератор 403 (и чтение, и отправка)", async () => {
  assert.equal((await guest.req("/api/v1/admin/push-demo")).status, 401);
  assert.equal((await guest.req("/api/v1/admin/push-demo", { method: "POST", body: { action: "test" } })).status, 401);
  for (const who of [U, M]) {
    assert.equal((await who.client.req("/api/v1/admin/push-demo")).status, 403, who.email);
    assert.equal((await demo(who, { action: "test", email: U.email })).status, 403, who.email);
  }
  // Страница панели — тоже только админу
  assert.equal((await M.client.req("/admin/push")).status, 403);
});

test("демо пушей: только шаблоны и тестовые аккаунты — свой текст, чужая почта, неизвестное действие → 400", async () => {
  assert.equal((await demo(A, { action: "test", email: U.email, text: "Произвольный текст" })).status, 400);
  assert.equal((await demo(A, { action: "test", email: "someone@gmail.com" })).status, 400);
  assert.equal((await demo(A, { action: "hack", email: U.email })).status, 400);
  assert.equal((await A.client.req("/api/v1/admin/push-demo?email=someone%40gmail.com")).status, 400);
});

test("демо пушей: без устройств — понятный текст; повтор раньше 10 секунд — 429; действие в журнале", async () => {
  const r = await demo(A, { action: "test", email: U.email });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.text, "Нет подписанных устройств — включите уведомления в профиле на телефоне.");
  assert.equal(r.json.title, "PicPac: уведомления работают");
  const again = await demo(A, { action: "test", email: U.email });
  assert.equal(again.status, 429);
  assert.equal(again.headers.get("retry-after"), "10");
  const { data: log } = await admin.from("audit_log").select("action, details").eq("user_id", A.id).eq("action", "admin.push_demo").limit(5);
  assert.ok(log?.length >= 1, "есть запись в журнале");
  assert.equal(log[0].details.action, "test");
  const g = await A.client.req(`/api/v1/admin/push-demo?email=${encodeURIComponent(U.email)}`);
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.found, true);
  assert.deepEqual(g.json.devices, []);
});

test("демо пушей: «Напомнить о корзине» — текст из настоящей корзины, пустая корзина — подсказка", async () => {
  const empty = await demo(A2, { action: "cart", email: U.email });
  assert.equal(empty.status, 200, empty.text);
  assert.match(empty.json.text, /Корзина клиента пуста/);
  const p = await U.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { size: "20x20", pages: 20, settings: { quantity: 1 } } } });
  assert.equal(p.status, 201, p.text);
  const put = await U.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  assert.equal(put.status, 200, put.text);
  await new Promise((r) => setTimeout(r, 10_500)); // лимит: раз в 10 секунд
  const r = await demo(A2, { action: "cart", email: U.email });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.body, /^В корзине: .+\. Оформим\?$/);
  assert.equal(r.json.text, "Нет подписанных устройств — включите уведомления в профиле на телефоне.");
});

test("профиль: «Проверить уведомления» — гость 401, лишнее поле 400, раз в минуту (второй раз 429)", async () => {
  assert.equal((await guest.req("/api/v1/push/test", { method: "POST", body: {} })).status, 401);
  assert.equal((await U.client.req("/api/v1/push/test", { method: "POST", body: { title: "свой текст" } })).status, 400);
  const r = await U.client.req("/api/v1/push/test", { method: "POST", body: {} });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, false);
  assert.match(r.json.text, /Нет подписанных устройств/);
  const again = await U.client.req("/api/v1/push/test", { method: "POST", body: {} });
  assert.equal(again.status, 429);
});
