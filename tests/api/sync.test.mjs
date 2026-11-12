// API-тесты S02c: синхронизация проекта с сервером (как делает lib/sync.js), серверная корзина
// с другого устройства, условия промокода для пересчёта на экране, дата курьера, идемпотентность оформления.
// Запуск: npm run test:api (сервер на http://localhost:3000) или BASE_URL=https://… npm run test:api
// Создаёт пользователя e2e-…@example.com и удаляет его в конце.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-sync-${randomUUID().slice(0, 8)}`;
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const recipient = { name: "Тест Тестович", phone: "+375 (29) 000-00-00" };

let C; // клиент: «первое устройство»
let C2; // тот же клиент: «второе устройство» (новый вход)
const s = {};

before(async () => {
  C = await createTestUser(admin, ["client"], "sync");
  C2 = { client: new Client("второе устройство") };
  const login = await C2.client.req("/api/v1/auth/login", { method: "POST", body: { email: C.email, password: C.password } });
  assert.equal(login.status, 200, login.text);
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  await deleteTestUser(admin, C);
});

async function addPhoto(projectId) {
  const u = await C.client.req(`/api/v1/projects/${projectId}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length, name: "x.jpg" } });
  assert.equal(u.status, 200, u.text);
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok, `хранилище: ${put.status}`);
  const c = await C.client.req(`/api/v1/projects/${projectId}/photos`, { method: "POST", body: { path: u.json.upload.path, quality: { w: 20, h: 20 } } });
  assert.equal(c.status, 201, c.text);
  return c.json.photo.id;
}

test("синхронизация: проект с 12 фото, новый порядок — после повторного входа порядок тот же", async () => {
  const p = await C.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { size: "20x20", pages: 20, settings: { quantity: 1 } } } });
  assert.equal(p.status, 201, p.text);
  s.project = p.json.project;
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await addPhoto(s.project.id));
  const order = [...ids].reverse();
  [order[0], order[5]] = [order[5], order[0]];
  const r = await C.client.req(`/api/v1/projects/${s.project.id}/photos/order`, { method: "PATCH", body: { order } });
  assert.equal(r.status, 200, r.text);
  // Повторный вход (новая сессия, «другое устройство»): порядок фото из базы
  const g = await C2.client.req(`/api/v1/projects/${s.project.id}`);
  assert.equal(g.status, 200, g.text);
  assert.deepEqual(
    g.json.project.photos.map((x) => x.id),
    order,
  );
  s.photos = order;
});

test("синхронизация: два устройства меняют настройки — второе получает 409, перечитывает версию и сохраняет", async () => {
  const v = s.project.version;
  const a = await C.client.req(`/api/v1/projects/${s.project.id}`, { method: "PATCH", body: { version: v, options: { pages: 22, settings: { quantity: 2 } } } });
  assert.equal(a.status, 200, a.text);
  const b = await C2.client.req(`/api/v1/projects/${s.project.id}`, { method: "PATCH", body: { version: v, options: { cover: "matte" } } });
  assert.equal(b.status, 409);
  assert.equal(b.json.error.code, "version_conflict");
  const g = await C2.client.req(`/api/v1/projects/${s.project.id}`);
  const b2 = await C2.client.req(`/api/v1/projects/${s.project.id}`, { method: "PATCH", body: { version: g.json.project.version, options: { pages: 22, settings: { quantity: 2 } } } });
  assert.equal(b2.status, 200, b2.text);
  assert.equal(b2.json.project.version, v + 2);
  assert.equal(b2.json.project.options.pages, 22);
});

test("серверная корзина видна с другого устройства, количество меняется, сумма пересчитывается сервером", async () => {
  const put = await C.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: s.project.id, quantity: 2 }] } });
  assert.equal(put.status, 200, put.text);
  const other = await C2.client.req("/api/v1/cart?delivery=europost&promo=TEST10");
  assert.equal(other.status, 200, other.text);
  const line = other.json.cart.items.find((i) => i.projectId === s.project.id);
  assert.ok(line, "позиция видна на втором устройстве");
  assert.equal(line.quantity, 2);
  assert.equal(line.lineTotalKop, line.unitPriceKop * 2);
  const t = other.json.totals;
  assert.equal(t.discountKop, Math.round(t.goodsKop * 0.1));
  assert.equal(t.totalKop, t.goodsKop - t.discountKop + t.deliveryKop);
});

test("промокод: ответ содержит условия кода для пересчёта на экране (TEST10 — 10%, PICPAC5 — от 50,00)", async () => {
  const a = await C.client.req("/api/v1/promo/validate", { method: "POST", body: { code: "test10" } });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.message, "Промокод применён");
  assert.equal(a.json.promo.kind, "percent");
  assert.equal(a.json.promo.value, 10);
  const guest = new Client("гость");
  const b = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: "PICPAC5", subtotal: 60 } });
  assert.equal(b.status, 200, b.text);
  assert.equal(b.json.promo.minTotalKop, 5000);
  const c = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: "PICPAC5", subtotal: 10 } });
  assert.equal(c.status, 200);
  assert.equal(c.json.valid, false);
  assert.match(c.json.message, /^Не подходит/);
});

test("курьер: без даты и с датой раньше срока → 400 с полем; с верной датой → заказ, дата сохранена", async () => {
  const body = (date) => ({
    delivery: { code: "courier-minsk", address: { street: "ул. Тестовая", house: "1", flat: "2", ...(date ? { date } : {}) } },
    recipient,
    paymentMethod: "erip_test",
  });
  const req = (key, date) => C.client.req("/api/v1/orders", { method: "POST", headers: { "idempotency-key": key }, body: body(date) });
  const none = await req(`${RUN}-a`);
  assert.equal(none.status, 400);
  assert.ok(none.json.error.fields["delivery.address.date"]);
  const early = await req(`${RUN}-b`, "2020-01-01");
  assert.equal(early.status, 400);
  const d = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const ok = await req(`${RUN}-c`, d);
  assert.equal(ok.status, 201, ok.text);
  assert.match(ok.json.order.number, /^PP-\d{6}-\d{5}$/);
  assert.equal(ok.json.order.delivery.address.date, d);
  // Повтор после «обрыва связи» с тем же ключом — тот же заказ
  const again = await req(`${RUN}-c`, d);
  assert.equal(again.status, 200);
  assert.equal(again.json.order.id, ok.json.order.id);
  assert.equal(again.json.replayed, true);
  // Корзина пуста на обоих устройствах, проект заказан
  assert.equal((await C2.client.req("/api/v1/cart")).json.cart.items.length, 0);
  assert.equal((await C2.client.req(`/api/v1/projects/${s.project.id}`)).json.project.status, "ordered");
});
