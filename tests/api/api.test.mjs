// API-тесты /api/v1: 401/403, чужие объекты (IDOR), идемпотентность, пересчёт суммы, промокоды,
// проверка ввода, лимит частоты, RLS напрямую через Supabase, журнал, выгрузка и удаление данных.
// Запуск: npm run test:api (сервер на http://localhost:3000) или BASE_URL=https://… npm run test:api
// Создаёт пользователей e2e-…@example.com и удаляет их в конце. Демо-аккаунты жюри не трогает.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { BASE, Client, createTestUser, deleteTestUser, supabaseAdmin, supabaseAnon } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-${randomUUID().slice(0, 8)}`;
const guest = new Client("гость");
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const FAKE = Buffer.from("это не картинка, а текст, переименованный в .jpg");
const recipient = { name: "Тест Тестович", phone: "+375 29 000-00-00" };
const NIL = "00000000-0000-4000-8000-000000000000";

let A; // клиент A
let B; // клиент B
let M; // модератор
const s = {}; // общее состояние сценария

before(async () => {
  const open = await guest.req("/api/v1/catalog");
  assert.equal(open.status, 200, `Сервер ${BASE} не отвечает на /api/v1/catalog (код ${open.status}). Запустите npm start.`);
  [A, B, M] = await Promise.all([
    createTestUser(admin, ["client"], "a"),
    createTestUser(admin, ["client"], "b"),
    createTestUser(admin, ["moderator"], "mod"),
  ]);
});

after(async () => {
  // Убрать за собой: тестовые заказы (по ключу идемпотентности), пользователей и их файлы
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  for (const u of [A, B, M]) await deleteTestUser(admin, u);
});

async function uploadPhoto(user, projectId, bytes = JPEG, mime = "image/jpeg") {
  const u = await user.client.req(`/api/v1/projects/${projectId}/photos/upload-url`, { method: "POST", body: { mime, bytes: bytes.length } });
  assert.equal(u.status, 200, u.text);
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: bytes });
  assert.ok(put.ok, `загрузка в хранилище: ${put.status} ${await put.text()}`);
  return { path: u.json.upload.path, commit: await user.client.req(`/api/v1/projects/${projectId}/photos`, { method: "POST", body: { path: u.json.upload.path } }) };
}

const order = (user, key, body = {}) =>
  user.client.req("/api/v1/orders", {
    method: "POST",
    headers: key ? { "idempotency-key": key } : {},
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 1" } }, recipient, ...body },
  });

// ───── Каталог ─────

test("каталог: ≥ 5 продуктов с размерами, ценами, сроками, требованиями к фото и 5 способов доставки", async () => {
  const r = await guest.req("/api/v1/catalog");
  assert.equal(r.status, 200);
  assert.ok(r.json.products.length >= 5);
  for (const p of r.json.products) {
    assert.ok(p.sizes.length > 0 && p.printDays > 0 && p.requirements?.formats?.length, p.slug);
    assert.ok(p.priceFromKop > 0, p.slug);
  }
  assert.equal(r.json.products.find((p) => p.slug === "layflat").price.base, 81);
  assert.ok(r.json.delivery.length >= 5);
  // Публичный кэш: локально видно s-maxage, на Vercel CDN забирает s-maxage себе и отдаёт браузеру max-age
  assert.match(r.headers.get("cache-control") || "", /public.*max-age|s-maxage/);
});

// ───── Гость: 401 ─────

const closed = [
  ["GET", "/api/v1/projects"],
  ["POST", "/api/v1/projects", { productSlug: "layflat" }],
  ["GET", "/api/v1/cart"],
  ["PUT", "/api/v1/cart", { items: [] }],
  ["GET", "/api/v1/orders"],
  ["POST", "/api/v1/orders", {}],
  ["GET", `/api/v1/orders/${NIL}`],
  ["POST", `/api/v1/orders/${NIL}/pay-test`, { method: "card_test" }],
  ["POST", `/api/v1/projects/${NIL}/photos/upload-url`, { mime: "image/jpeg", bytes: 10 }],
  ["GET", `/api/v1/photos/${NIL}/url`],
  ["GET", `/api/v1/interactions/${NIL}/messages`],
  ["GET", "/api/v1/me/export"],
  ["DELETE", "/api/v1/me/photos"],
];
for (const [method, path, body] of closed) {
  test(`гость → ${method} ${path.replace(NIL, "{id}")} → 401`, async () => {
    const r = await guest.req(path, { method, body });
    assert.equal(r.status, 401);
    assert.equal(r.json.error.code, "unauthorized");
    assert.ok(r.json.error.requestId, "в ошибке есть requestId");
  });
}

// ───── Роли: 403 ─────

test("клиент и модератор → админский журнал → 403", async () => {
  assert.equal((await A.client.req("/api/v1/admin/audit")).status, 403);
  assert.equal((await M.client.req("/api/v1/admin/audit")).status, 403);
});

test("удаление проекта с чужого сайта (Origin) → 403", async () => {
  const r = await A.client.req(`/api/v1/projects/${NIL}`, { method: "DELETE", headers: { origin: "https://evil.example" } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error.code, "bad_origin");
});

test("модератор не может создавать проекты клиента → 403", async () => {
  const r = await M.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat" } });
  assert.equal(r.status, 403);
});

// ───── Проекты и проверка ввода ─────

test("клиент A создаёт проект Classic, версия 1", async () => {
  const r = await A.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Отпуск", options: { size: "20x20", pages: 20 } } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.project.version, 1);
  assert.equal(r.json.project.options.cover, "gloss");
  s.project = r.json.project;
});

test("проверка ввода: неизвестный продукт, нечётные страницы, лишние поля → 400 с понятным текстом", async () => {
  const bad1 = await A.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "<script>" } });
  assert.equal(bad1.status, 400);
  assert.equal(bad1.json.error.code, "invalid_input");
  assert.match(bad1.json.error.message, /продукт/i);
  const bad2 = await A.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { size: "20x20", pages: 21 } } });
  assert.equal(bad2.status, 400);
  assert.match(bad2.json.error.message, /страниц/);
  const bad3 = await A.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { evil: 1 } } });
  assert.equal(bad3.status, 400);
  const notJson = await A.client.req("/api/v1/projects", { method: "POST", raw: "productSlug=layflat", headers: { "content-type": "application/x-www-form-urlencoded" } });
  assert.equal(notJson.status, 400);
});

test("PATCH с версией: успех, затем старая версия → 409 «изменили на другом устройстве»", async () => {
  const ok = await A.client.req(`/api/v1/projects/${s.project.id}`, { method: "PATCH", body: { version: 1, title: "Отпуск 2026" } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.project.version, 2);
  const stale = await A.client.req(`/api/v1/projects/${s.project.id}`, { method: "PATCH", body: { version: 1, title: "Затираю" } });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "version_conflict");
  assert.match(stale.json.error.message, /другом устройстве/);
});

test("IDOR: клиент B не видит, не меняет и не удаляет проект A (404)", async () => {
  const id = s.project.id;
  assert.equal((await B.client.req(`/api/v1/projects/${id}`)).status, 404);
  assert.equal((await B.client.req(`/api/v1/projects/${id}`, { method: "PATCH", body: { version: 2, title: "чужое" } })).status, 404);
  assert.equal((await B.client.req(`/api/v1/projects/${id}`, { method: "DELETE" })).status, 404);
  assert.equal((await B.client.req(`/api/v1/projects/${id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: 100 } })).status, 404);
  const list = await B.client.req("/api/v1/projects");
  assert.equal(list.json.items.length, 0);
});

// ───── Фото ─────

test("загрузка: GIF и файл больше 25 МБ отклоняются до загрузки", async () => {
  const gif = await A.client.req(`/api/v1/projects/${s.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/gif", bytes: 1000 } });
  assert.equal(gif.status, 400);
  assert.match(gif.json.error.message, /JPEG/);
  const big = await A.client.req(`/api/v1/projects/${s.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: 26 * 1024 * 1024 } });
  assert.equal(big.status, 400);
  assert.match(big.json.error.message, /25 МБ/);
});

test("загрузка JPEG по подписанной ссылке и фиксация: размеры берутся из файла", async () => {
  const { commit, path } = await uploadPhoto(A, s.project.id);
  assert.equal(commit.status, 201, commit.text);
  assert.equal(commit.json.photo.width, 800);
  assert.equal(commit.json.photo.mime, "image/jpeg");
  s.photo = commit.json.photo;
  s.photoPath = path;
  const second = await uploadPhoto(A, s.project.id);
  assert.equal(second.commit.status, 201);
  s.photo2 = second.commit.json.photo;
  // Третий файл загружаем, но не фиксируем: попробуем добавить его после заказа
  const u = await A.client.req(`/api/v1/projects/${s.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok);
  s.pendingPath = u.json.upload.path;
});

test("подделка: текст под видом JPEG отклоняется по первым байтам и удаляется", async () => {
  const { commit, path } = await uploadPhoto(A, s.project.id, FAKE);
  assert.equal(commit.status, 400);
  assert.equal(commit.json.error.code, "unsupported_format");
  const { data } = await admin.storage.from("photos").list(path.split("/").slice(0, 2).join("/"));
  assert.ok(!(data || []).some((f) => path.endsWith(f.name)), "файл подделки удалён из хранилища");
});

test("IDOR: B не может зафиксировать путь A в своём проекте и получить ссылку на фото A", async () => {
  const mine = await B.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "photo" } });
  s.projectB = mine.json.project;
  const steal = await B.client.req(`/api/v1/projects/${s.projectB.id}/photos`, { method: "POST", body: { path: s.photoPath } });
  assert.equal(steal.status, 400);
  assert.equal(steal.json.error.code, "invalid_path");
  assert.equal((await B.client.req(`/api/v1/photos/${s.photo.id}/url`)).status, 404);
  assert.equal((await B.client.req(`/api/v1/projects/${s.project.id}/photos/${s.photo.id}`, { method: "DELETE" })).status, 404);
  const own = await A.client.req(`/api/v1/photos/${s.photo.id}/url`);
  assert.equal(own.status, 200);
  assert.equal(own.json.expiresIn, 600);
  assert.equal((await fetch(own.json.url)).status, 200);
});

test("порядок фото: неверный список → 400, верный → 200", async () => {
  const bad = await A.client.req(`/api/v1/projects/${s.project.id}/photos/order`, { method: "PATCH", body: { order: [s.photo.id] } });
  assert.equal(bad.status, 400);
  const ok = await A.client.req(`/api/v1/projects/${s.project.id}/photos/order`, { method: "PATCH", body: { order: [s.photo2.id, s.photo.id] } });
  assert.equal(ok.status, 200, ok.text);
  const p = await A.client.req(`/api/v1/projects/${s.project.id}`);
  assert.deepEqual(p.json.project.photos.map((x) => x.id), [s.photo2.id, s.photo.id]);
});

// ───── Корзина и промокоды ─────

test("корзина: B не может положить проект A (404); A кладёт свой — сервер считает 81,00", async () => {
  const foreign = await B.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: s.project.id, quantity: 1 }] } });
  assert.equal(foreign.status, 404);
  const r = await A.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: s.project.id, quantity: 1 }] } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.cart.goodsKop, 8100);
  const t = await A.client.req("/api/v1/cart?delivery=europost&promo=TEST10");
  assert.equal(t.json.totals.totalKop, 8100 - 810 + 590);
});

test("промокоды: TEST10 применён, неизвестный — «Не подходит», истёкший — «Истёк», мин. сумма PICPAC5", async () => {
  const ok = await A.client.req("/api/v1/promo/validate", { method: "POST", body: { code: "test10" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.message, "Промокод применён");
  assert.equal(ok.json.discountKop, 810);
  const none = await A.client.req("/api/v1/promo/validate", { method: "POST", body: { code: "NOPE42" } });
  assert.equal(none.status, 422);
  assert.match(none.json.error.message, /^Не подходит/);
  const old = await A.client.req("/api/v1/promo/validate", { method: "POST", body: { code: "OLD2025" } });
  assert.equal(old.status, 422);
  assert.equal(old.json.error.code, "promo_expired");
  assert.match(old.json.error.message, /^Истёк/);
  const low = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: "PICPAC5", subtotal: 40 } });
  assert.equal(low.status, 422);
  assert.equal(low.json.error.code, "promo_min_total");
  const enough = await A.client.req("/api/v1/promo/validate", { method: "POST", body: { code: "PICPAC5" } });
  assert.equal(enough.json.discountKop, 500);
});

// ───── Заказы ─────

test("заказ без Idempotency-Key → 400", async () => {
  const r = await order(A, null);
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "idempotency_key_required");
});

test("заказ: адрес обязателен для способа доставки → 400 с полями", async () => {
  const r = await order(A, `${RUN}-noaddr`, { delivery: { code: "belpost", address: {} } });
  assert.equal(r.status, 400);
  assert.ok(r.json.error.fields["delivery.address.city"]);
});

test("сервер пересчитывает итог: подменённые цены в запросе игнорируются", async () => {
  s.key1 = `${RUN}-1`;
  const r = await order(A, s.key1, { total: 0.01, totalKop: 1, goods_kop: 1, items: [{ projectId: s.project.id, price: 0.01 }], promoCode: "TEST10" });
  assert.equal(r.status, 201, r.text);
  const o = r.json.order;
  assert.equal(o.goodsKop, 8100);
  assert.equal(o.discountKop, 810);
  assert.equal(o.deliveryKop, 590);
  assert.equal(o.totalKop, 7880);
  assert.equal(o.currency, "BYN");
  assert.match(o.number, /^PP-\d{6}-\d{5}$/);
  assert.equal(o.status, "accepted");
  assert.equal(o.timeline.length, 5);
  s.order = o;
});

test("идемпотентность: тот же ключ → тот же заказ, второй не создаётся", async () => {
  const again = await order(A, s.key1);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  assert.equal(again.json.order.number, s.order.number);
  const parallel = await Promise.all([order(A, s.key1), order(A, s.key1)]);
  for (const p of parallel) assert.equal(p.json.order.number, s.order.number);
  const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("idempotency_key", s.key1);
  assert.equal(count, 1);
});

test("заказанный проект менять нельзя: порядок фото и новое фото → 409, в заказе — снимок списка фото", async () => {
  const reorder = await A.client.req(`/api/v1/projects/${s.project.id}/photos/order`, { method: "PATCH", body: { order: [s.photo.id, s.photo2.id] } });
  assert.equal(reorder.status, 409);
  assert.equal(reorder.json.error.code, "project_ordered");
  const add = await A.client.req(`/api/v1/projects/${s.project.id}/photos`, { method: "POST", body: { path: s.pendingPath } });
  assert.equal(add.status, 409);
  assert.equal(add.json.error.code, "project_ordered");
  const del = await A.client.req(`/api/v1/projects/${s.project.id}/photos/${s.photo.id}`, { method: "DELETE" });
  assert.equal(del.status, 409);
  const p = await A.client.req(`/api/v1/projects/${s.project.id}`);
  assert.equal(p.json.project.photos.length, 2);
  // Файл, который пытались добавить в заказанный проект, удалён из хранилища
  const folder = s.pendingPath.split("/").slice(0, 2).join("/");
  const { data } = await admin.storage.from("photos").list(folder);
  assert.ok(!(data || []).some((f) => s.pendingPath.endsWith(f.name)));
  // Снимок заказа: список фото с порядком, как в момент оформления
  const o = await A.client.req(`/api/v1/orders/${s.order.id}`);
  assert.deepEqual(o.json.order.items[0].snapshot.photos.map((x) => x.id), [s.photo2.id, s.photo.id]);
  assert.ok(o.json.order.items[0].snapshot.photos.every((x) => x.path && x.width > 0));
  // Даже напрямую в базе (сервисным ключом) фото в заказанный проект не добавить — страж в триггере
  const { error } = await admin.from("project_photos").update({ position: 99 }).eq("id", s.photo.id);
  assert.match(error?.message || "", /project_ordered/);
});

test("разные ключи → разные заказы (новый проект Lite с фото)", async () => {
  const p = await A.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "pages-book", options: { size: "20x20", pages: 24 } } });
  assert.equal(p.status, 201);
  s.project2 = p.json.project;
  const up = await uploadPhoto(A, s.project2.id);
  assert.equal(up.commit.status, 201);
  const empty = await order(A, `${RUN}-empty`);
  assert.equal(empty.status, 409, "корзина пуста после первого заказа");
  await A.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: s.project2.id, quantity: 2 }] } });
  // Гонка: три параллельных заказа одной корзины с разными ключами → создаётся ровно один
  const race = await Promise.all([order(A, `${RUN}-2`), order(A, `${RUN}-race-b`), order(A, `${RUN}-race-c`)]);
  const created = race.filter((x) => x.status === 201);
  assert.equal(created.length, 1, race.map((x) => x.status).join(","));
  // Проигравшие получают 409: «корзина изменилась» (ждали блокировку) или «корзина пуста» (пришли после первого заказа)
  for (const x of race.filter((y) => y.status !== 201)) {
    assert.equal(x.status, 409);
    assert.ok(["cart_changed", "cart_empty"].includes(x.json.error.code), x.json.error.code);
  }
  const { count: raced } = await admin.from("orders").select("id", { count: "exact", head: true }).like("idempotency_key", `${RUN}-%`).neq("idempotency_key", s.key1);
  assert.equal(raced, 1);
  const r = created[0];
  assert.notEqual(r.json.order.number, s.order.number);
  assert.equal(r.json.order.goodsKop, 14000);
  const list = await A.client.req("/api/v1/orders");
  assert.equal(list.json.items.length, 2);
});

test("IDOR: B не видит и не оплачивает заказ A (по id и по номеру)", async () => {
  assert.equal((await B.client.req(`/api/v1/orders/${s.order.id}`)).status, 404);
  assert.equal((await B.client.req(`/api/v1/orders/${s.order.number}`)).status, 404);
  assert.equal((await B.client.req(`/api/v1/orders/${s.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } })).status, 404);
  assert.equal((await B.client.req(`/api/v1/orders/${s.order.id}/interactions`, { method: "POST", body: { topic: "x", message: "y" } })).status, 404);
  assert.equal((await B.client.req("/api/v1/orders")).json.items.length, 0);
});

test("тестовая оплата: проходит один раз, без данных карты", async () => {
  const r = await A.client.req(`/api/v1/orders/${s.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.order.payment.status, "paid_test");
  const again = await A.client.req(`/api/v1/orders/${s.order.number}/pay-test`, { method: "POST", body: { method: "erip_test" } });
  assert.equal(again.json.alreadyPaid, true);
  assert.equal(again.json.order.payment.method, "card_test");
});

// ───── Обращения ─────

test("обращение по заказу: создаётся с ответом бота; B не читает и не пишет в чужое", async () => {
  const r = await A.client.req(`/api/v1/orders/${s.order.id}/interactions`, { method: "POST", body: { topic: "Где мой заказ?", message: "Подскажите срок" } });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.messages.length, 2);
  assert.equal(r.json.messages[1].author, "bot");
  s.interaction = r.json.interaction;
  assert.equal((await B.client.req(`/api/v1/interactions/${s.interaction.id}/messages`)).status, 404);
  assert.equal((await B.client.req(`/api/v1/interactions/${s.interaction.id}/messages`, { method: "POST", body: { body: "чужое" } })).status, 404);
  const msg = await A.client.req(`/api/v1/interactions/${s.interaction.id}/messages`, { method: "POST", body: { body: "Спасибо!" } });
  assert.equal(msg.status, 201);
  const list = await A.client.req(`/api/v1/interactions/${s.interaction.id}/messages`);
  assert.equal(list.json.messages.length, 3);
  const o = await A.client.req(`/api/v1/orders/${s.order.id}`);
  assert.equal(o.json.order.interactions.length, 1);
});

// ───── RLS напрямую ─────

test("RLS: публичный ключ Supabase (anon) не видит ни одной строки и ни одного файла", async () => {
  const anon = supabaseAnon();
  for (const table of ["projects", "project_photos", "cart_items", "orders", "order_items", "interactions", "interaction_messages", "promo_codes", "products", "audit_log", "profiles"]) {
    const { data, error } = await anon.from(table).select("*").limit(5);
    assert.ok(error || (data || []).length === 0, `${table}: anon видит строки`);
  }
  const pub = await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/public/photos/${s.photoPath}`);
  assert.notEqual(pub.status, 200, "фото недоступно без подписи");
  const { data: files } = await anon.storage.from("photos").list(A.id);
  assert.equal((files || []).length, 0);
});

// ───── Журнал ─────

test("«Продолжить всё равно» (S02b): гость → 401, чужой сайт → 403, клиент → 200 и запись в журнале", async () => {
  const body = { issue: "dpi", title: "Может быть нечётко", productSlug: "layflat", projectId: "local-1" };
  assert.equal((await guest.req("/api/v1/checks/ack", { method: "POST", body })).status, 401);
  const evil = await A.client.req("/api/v1/checks/ack", { method: "POST", body, headers: { origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const bad = await A.client.req("/api/v1/checks/ack", { method: "POST", body: { issue: "" } });
  assert.equal(bad.status, 400);
  const r = await A.client.req("/api/v1/checks/ack", { method: "POST", body });
  assert.equal(r.status, 200, r.text);
  const { data } = await admin.from("audit_log").select("action, details").eq("user_id", A.id).eq("action", "check.continue_anyway");
  assert.ok(data.some((x) => x.details?.issue === "dpi" && x.details?.product === "layflat"), "отметка записана в журнал");
});

test("журнал (ОТ-04): записаны создание проекта, фото, корзина, заказ, оплата, обращение и отказы", async () => {
  const { data } = await admin.from("audit_log").select("action, result, object_id").eq("user_id", A.id);
  const seen = new Set(data.map((r) => `${r.action}:${r.result}`));
  for (const a of ["project.create:success", "project.update:denied", "photo.add:success", "photo.add:denied", "cart.update:success", "order.create:success", "order.pay_test:success", "interaction.create:success"]) {
    assert.ok(seen.has(a), `нет записи ${a}`);
  }
  const { data: bLog } = await admin.from("audit_log").select("action, result").eq("user_id", B.id).eq("result", "denied");
  assert.ok(bLog.length >= 3, "отказы B (чужие объекты) записаны");
});

// ───── Лимит частоты ─────

test("лимит частоты: больше 20 проверок промокода за минуту → 429", async () => {
  // Пачка из 25 параллельных запросов попадает в одно минутное окно; если окно сменилось посередине — вторая пачка
  let limited = null;
  for (let attempt = 0; attempt < 2 && !limited; attempt++) {
    const burst = await Promise.all(
      Array.from({ length: 25 }, () => B.client.req("/api/v1/promo/validate", { method: "POST", body: { code: "TEST10", subtotal: 10 } })),
    );
    limited = burst.find((r) => r.status === 429) || null;
  }
  assert.ok(limited, "нет ответа 429");
  assert.equal(limited.json.error.code, "rate_limited");
  assert.ok(limited.headers.get("retry-after"));
});

// ───── Мои данные ─────

test("выгрузка моих данных: JSON с заказами, проектами и журналом", async () => {
  const r = await A.client.req("/api/v1/me/export");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition") || "", /attachment/);
  assert.equal(r.json.orders.length, 2);
  assert.ok(r.json.projects.length >= 2);
  assert.ok(r.json.auditLog.length > 0);
});

test("удалить мои фото: фото заказов в работе — запрос на удаление, остальные удалены", async () => {
  const p = await A.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "photo" } });
  await uploadPhoto(A, p.json.project.id);
  const r = await A.client.req("/api/v1/me/photos", { method: "DELETE" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.deleted, 1);
  assert.equal(r.json.kept, 3);
  assert.equal(r.json.request.kind, "delete_photos");
});

test("удаление аккаунта: файлы удалены, заказы обезличены и остались", async () => {
  const r = await A.client.req("/api/v1/me", { method: "DELETE", body: { password: A.password } });
  assert.equal(r.status, 200, r.text);
  const { data: orders } = await admin.from("orders").select("user_id, recipient, anonymized_at").like("idempotency_key", `${RUN}%`);
  assert.equal(orders.length, 2);
  for (const o of orders) {
    assert.equal(o.user_id, null);
    assert.deepEqual(o.recipient, {});
    assert.ok(o.anonymized_at);
  }
  const { data: files } = await admin.storage.from("photos").list(A.id);
  assert.equal((files || []).length, 0);
  const { count } = await admin.from("projects").select("id", { count: "exact", head: true }).eq("user_id", A.id);
  assert.equal(count, 0);
  A = null;
});
