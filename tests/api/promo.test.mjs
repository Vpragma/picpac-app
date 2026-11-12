// API-тесты промокодов и открыток (N8): роль на админских маршрутах (гость 401, клиент и модератор 403),
// создание/изменение/выключение кода с записью в журнал, статистика, подмена суммы, повтор и двойное применение,
// лимит при параллельных заказах, чужой личный код, открытка к заказу (одна на заказ), сезонная плашка.
// Запуск: BASE_URL=http://127.0.0.1:3305 npm run test:api (или node --test tests/api/promo.test.mjs).
// Создаёт пользователей e2e-…@example.com и коды E2E…; в конце удаляет их, заказы и открытки. Журнал не трогает.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { BASE, Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-n8-${randomUUID().slice(0, 8)}`;
const TAG = "E2E" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(); // префикс тестовых кодов
const guest = new Client("гость");
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const recipient = { name: "Тест Тестович", phone: "+375 29 000-00-00" };
const delivery = { code: "europost", address: { pickup_point: "Минск, пункт 1" } };

let A; // клиент A
let B; // клиент B
let C; // клиент C
let M; // модератор
let ADM; // администратор
const s = {};

before(async () => {
  const open = await guest.req("/api/v1/catalog");
  assert.equal(open.status, 200, `Сервер ${BASE} не отвечает (код ${open.status}). Запустите сервер.`);
  [A, B, C, M, ADM] = await Promise.all([
    createTestUser(admin, ["client"], "n8a"),
    createTestUser(admin, ["client"], "n8b"),
    createTestUser(admin, ["client"], "n8c"),
    createTestUser(admin, ["moderator"], "n8mod"),
    createTestUser(admin, ["admin"], "n8adm"),
  ]);
});

after(async () => {
  // Заказы теста (по ключу) → каскадом их применения кодов и открытки; затем тестовые коды и пользователи
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  await admin.from("promo_codes").delete().like("code", `${TAG}%`);
  for (const u of [A, B, C, M, ADM]) await deleteTestUser(admin, u);
});

async function cartWithBook(user) {
  const p = await user.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "N8", options: { size: "20x20", pages: 20 } } });
  assert.equal(p.status, 201, p.text);
  const u = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  assert.equal(u.status, 200, u.text);
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok, `загрузка в хранилище: ${put.status}`);
  const c = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(c.status, 201, c.text);
  const cart = await user.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  assert.equal(cart.status, 200, cart.text);
  assert.equal(cart.json.cart.goodsKop, 8100);
  return p.json.project;
}

const order = (user, key, promoCode) =>
  user.client.req("/api/v1/orders", { method: "POST", headers: { "idempotency-key": key }, body: { delivery, recipient, ...(promoCode ? { promoCode } : {}) } });
const validate = (user, body) => user.client.req("/api/v1/promo/validate", { method: "POST", body });
const createCode = (body) => ADM.client.req("/api/v1/admin/promo", { method: "POST", body });
const patchCode = (code, body, who = ADM) => who.client.req(`/api/v1/admin/promo/${code}`, { method: "PATCH", body });
const uses = async (code) => (await admin.from("promo_redemptions").select("id", { count: "exact", head: true }).eq("code", code)).count;

// ───── Роли на админских маршрутах ─────

test("админка «Промокоды»: гость → 401, клиент и модератор → 403 (страница, список, создание, изменение)", async () => {
  const body = { code: `${TAG}X`, kind: "percent", value: 10 };
  for (const [who, expected] of [
    [guest, 401],
    [A.client, 403],
    [M.client, 403],
  ]) {
    const list = await who.req("/api/v1/admin/promo");
    assert.equal(list.status, expected, `GET ${who.name}`);
    const create = await who.req("/api/v1/admin/promo", { method: "POST", body });
    assert.equal(create.status, expected, `POST ${who.name}`);
    const patch = await who.req("/api/v1/admin/promo/TEST10", { method: "PATCH", body: { active: false } });
    assert.equal(patch.status, expected, `PATCH ${who.name}`);
    const page = await who.req("/admin/promo");
    assert.equal(page.status, expected, `страница ${who.name}`);
  }
  const { data } = await admin.from("promo_codes").select("code").eq("code", `${TAG}X`);
  assert.equal(data.length, 0, "код не создан");
  const { data: t10 } = await admin.from("promo_codes").select("active").eq("code", "TEST10").single();
  assert.equal(t10.active, true, "TEST10 не выключен");
});

test("админ создаёт коды: проверка ввода, дубль → 409, запись в журнал", async () => {
  const bad = await createCode({ code: "a b", kind: "percent", value: 150 });
  assert.equal(bad.status, 400);
  assert.ok(bad.json.error.fields.code && bad.json.error.fields.value, bad.text);
  const badProduct = await createCode({ code: `${TAG}BAD`, kind: "percent", value: 5, productSlugs: ["nope-book"] });
  assert.equal(badProduct.status, 400);
  // X: −20% на Classic, один раз всего; Y: −5 BYN, один раз всего (для параллельных заказов); Z: без лимитов
  const x = await createCode({ code: `${TAG}x`, kind: "percent", value: 20, productSlugs: ["layflat"], maxUses: 1, label: "тест N8", validTo: "2030-12-31" });
  assert.equal(x.status, 201, x.text);
  assert.equal(x.json.promo.code, `${TAG}X`);
  assert.equal(x.json.promo.status, "active");
  const y = await createCode({ code: `${TAG}Y`, kind: "amount", value: 500, maxUses: 1 });
  assert.equal(y.status, 201, y.text);
  const z = await createCode({ code: `${TAG}Z`, kind: "percent", value: 5, maxUsesPerUser: 1 });
  assert.equal(z.status, 201, z.text);
  const dup = await createCode({ code: `${TAG}X`, kind: "percent", value: 10 });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, "promo_exists");
  const { data: log } = await admin.from("audit_log").select("action, result, user_id").eq("object_id", `${TAG}X`).eq("action", "admin.promo_create");
  assert.ok(log.some((r) => r.result === "success" && r.user_id === ADM.id), "создание в журнале");
  assert.ok(log.some((r) => r.result === "denied"), "дубль в журнале");
});

test("корзины трёх клиентов: Classic 20×20 — 81,00 BYN", async () => {
  [s.pa, s.pb, s.pc] = await Promise.all([cartWithBook(A), cartWithBook(B), cartWithBook(C)]);
});

// ───── Проверка кода: сервер считает по своей корзине ─────

test("подмена суммы: вошедший клиент — скидка по корзине на сервере, присланные сумма и позиции не читаются", async () => {
  const forged = await validate(A, { code: "BIGBOOK30", subtotal: 99999, lines: [{ slug: "layflat", kop: 9_000_000 }] });
  assert.equal(forged.status, 200);
  assert.equal(forged.json.valid, false);
  assert.equal(forged.json.code, "promo_min_total");
  assert.match(forged.json.message, /минимальная сумма заказа .*200,00 BYN/);
  const x = await validate(A, { code: `${TAG}X`, subtotal: 1 });
  assert.equal(x.json.valid, true, x.text);
  assert.equal(x.json.source, "cart");
  assert.equal(x.json.discountKop, 1620);
  // Лишние поля в заказе (сумма, скидка) → 400: итог считает только сервер
  const extra = await A.client.req("/api/v1/orders", { method: "POST", headers: { "idempotency-key": `${RUN}-extra` }, body: { delivery, recipient, promoCode: `${TAG}X`, discountKop: 8100 } });
  assert.equal(extra.status, 400);
});

test("понятные ошибки: «не для этого продукта», «истёк», «нет такого», гостю личный код — «войдите»", async () => {
  const wrong = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: "OSEN2026", lines: [{ slug: "photo", kop: 1300 }] } });
  assert.equal(wrong.json.code, "promo_wrong_product");
  assert.match(wrong.json.message, /^Не для этого продукта/);
  const old = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: "LETO2025", subtotal: 50 } });
  assert.equal(old.json.code, "promo_expired");
  assert.match(old.json.message, /^Истёк/);
  const none = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: "NOPE" + TAG.slice(3) } });
  assert.equal(none.json.code, "promo_not_found");
});

// ───── Применение кода к заказу ─────

test("заказ с кодом: скидка только на подходящие продукты, повтор и двойное нажатие не тратят лимит дважды", async () => {
  s.keyA1 = `${RUN}-a1`;
  const r = await order(A, s.keyA1, `${TAG}X`);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.order.discountKop, 1620);
  assert.equal(r.json.order.totalKop, 8100 - 1620 + 590);
  assert.equal(r.json.order.promoCode, `${TAG}X`);
  s.orderA1 = r.json.order;
  const again = await Promise.all([order(A, s.keyA1, `${TAG}X`), order(A, s.keyA1, `${TAG}X`)]);
  for (const a of again) {
    assert.equal(a.status, 200, a.text);
    assert.equal(a.json.replayed, true);
    assert.equal(a.json.order.number, s.orderA1.number);
  }
  assert.equal(await uses(`${TAG}X`), 1, "одно применение");
  // Лимит «всего 1» исчерпан — другому клиенту код уже не подходит
  const b = await validate(B, { code: `${TAG}X` });
  assert.equal(b.json.valid, false);
  assert.equal(b.json.code, "promo_limit");
  assert.match(b.json.message, /^Лимит использований исчерпан/);
});

test("параллельные заказы двух клиентов с кодом «один раз всего» → один заказ со скидкой, второй — 422 «лимит исчерпан»", async () => {
  const [rb, rc] = await Promise.all([order(B, `${RUN}-b1`, `${TAG}Y`), order(C, `${RUN}-c1`, `${TAG}Y`)]);
  const statuses = [rb.status, rc.status].sort();
  assert.deepEqual(statuses, [201, 422], `${rb.status} ${rb.text.slice(0, 200)} | ${rc.status} ${rc.text.slice(0, 200)}`);
  const lost = rb.status === 422 ? rb : rc;
  assert.equal(lost.json.error.code, "promo_limit");
  assert.equal(await uses(`${TAG}Y`), 1);
  s.loser = rb.status === 422 ? B : C;
  s.loserKey = rb.status === 422 ? `${RUN}-b2` : `${RUN}-c2`;
});

// ───── Открытка с личным кодом ─────

test("открытка: к заказу выдан личный код (−10%, со сроком), повторный показ не создаёт второй", async () => {
  const card = s.orderA1.card;
  assert.ok(card, "в ответе заказа есть открытка");
  assert.match(card.code, /^PP[A-Z0-9]{8}$/);
  assert.equal(card.kind, "percent");
  assert.equal(card.value, 10);
  assert.equal(card.personal, true);
  assert.equal(card.status, "active");
  assert.ok(new Date(card.validTo) > new Date(Date.now() + 50 * 86400_000), "срок ~60 дней");
  const view = await A.client.req(`/api/v1/orders/${s.orderA1.id}`);
  assert.equal(view.json.order.card.code, card.code);
  const replay = await order(A, s.keyA1, `${TAG}X`);
  assert.equal(replay.json.order.card.code, card.code);
  const list = await A.client.req("/api/v1/orders");
  assert.equal(list.json.items.find((o) => o.id === s.orderA1.id).card.code, card.code, "код виден в «Мои заказы»");
  const { count } = await admin.from("promo_codes").select("code", { count: "exact", head: true }).eq("source_order_id", s.orderA1.id);
  assert.equal(count, 1, "одна открытка на заказ");
  s.cardA = card.code;
});

test("чужой личный код: проверка → «личный код другого клиента», заказ с ним → 422, без кода — оформляется", async () => {
  const v = await validate(s.loser, { code: s.cardA });
  assert.equal(v.json.valid, false);
  assert.equal(v.json.code, "promo_not_yours");
  const o = await order(s.loser, s.loserKey, s.cardA);
  assert.equal(o.status, 422, o.text);
  assert.equal(o.json.error.code, "promo_not_yours");
  const g = await guest.req("/api/v1/promo/validate", { method: "POST", body: { code: s.cardA, subtotal: 100 } });
  assert.equal(g.json.code, "promo_login_required");
  const plain = await order(s.loser, s.loserKey);
  assert.equal(plain.status, 201, plain.text);
  assert.ok(plain.json.order.card, "у каждого заказа своя открытка");
  assert.notEqual(plain.json.order.card.code, s.cardA);
});

test("свой личный код: применяется один раз (−10%), второй раз — «код уже использован», в «Мои заказы» — «использован»", async () => {
  await cartWithBook(A);
  const v = await validate(A, { code: s.cardA.toLowerCase() });
  assert.equal(v.json.valid, true, v.text);
  assert.equal(v.json.discountKop, 810);
  assert.equal(v.json.promo.personal, true);
  const o = await order(A, `${RUN}-a2`, s.cardA);
  assert.equal(o.status, 201, o.text);
  assert.equal(o.json.order.discountKop, 810);
  const used = await validate(A, { code: s.cardA, subtotal: 100 });
  assert.equal(used.json.valid, false);
  assert.equal(used.json.code, "promo_used");
  assert.match(used.json.message, /^Код уже использован/);
  const list = await A.client.req("/api/v1/orders");
  assert.equal(list.json.items.find((x) => x.id === s.orderA1.id).card.status, "used");
});

// ───── Админ: статистика, изменение, выключение ─────

test("админ: список со статистикой (применён раз, сумма заказов), изменить и выключить — сразу действует, всё в журнале", async () => {
  const list = await ADM.client.req("/api/v1/admin/promo");
  assert.equal(list.status, 200, list.text);
  const x = list.json.items.find((i) => i.code === `${TAG}X`);
  assert.equal(x.stats.uses, 1);
  assert.equal(x.stats.totalKop, 8100 - 1620 + 590);
  assert.equal(x.stats.discountKop, 1620);
  assert.equal(x.status, "exhausted");
  assert.ok(list.json.summary.cardsIssued >= 3);
  const personal = await ADM.client.req("/api/v1/admin/promo?type=personal");
  assert.ok(personal.json.items.some((i) => i.code === s.cardA && i.personal && i.stats.uses === 1 && i.sourceOrder === s.orderA1.number));

  const okZ = await validate(B, { code: `${TAG}Z`, subtotal: 10 });
  assert.equal(okZ.json.valid, true, okZ.text);
  const edit = await patchCode(`${TAG}Z`, { value: 15, minTotalKop: 5000, validTo: "2030-01-31", label: "изменён" });
  assert.equal(edit.status, 200, edit.text);
  assert.equal(edit.json.promo.value, 15);
  const badEdit = await patchCode(`${TAG}Z`, { value: 0 });
  assert.equal(badEdit.status, 400);
  const off = await patchCode(`${TAG}Z`, { active: false });
  assert.equal(off.status, 200);
  assert.equal(off.json.promo.status, "disabled");
  const dis = await validate(B, { code: `${TAG}Z`, subtotal: 100 });
  assert.equal(dis.json.code, "promo_disabled");
  const on = await patchCode(`${TAG}Z`, { active: true });
  assert.equal(on.json.promo.active, true);
  const missing = await patchCode(`${TAG}NONE`, { active: false });
  assert.equal(missing.status, 404);
  const { data: log } = await admin.from("audit_log").select("action, details").eq("object_id", `${TAG}Z`).in("action", ["admin.promo_update", "admin.promo_disable", "admin.promo_enable"]);
  const actions = log.map((r) => r.action);
  for (const a of ["admin.promo_update", "admin.promo_disable", "admin.promo_enable"]) assert.ok(actions.includes(a), `${a} в журнале`);
  const upd = log.find((r) => r.action === "admin.promo_update");
  assert.equal(upd.details.before.value, 5);
  assert.equal(upd.details.after.value, 15);
});

test("сезонная плашка: код сезона без входа; неизвестный сезон — пусто; учёт применений закрыт для клиента (RLS)", async () => {
  const autumn = await guest.req("/api/v1/promo/seasonal?season=autumn");
  assert.equal(autumn.status, 200);
  assert.equal(autumn.json.promo?.code, "OSEN2026");
  assert.match(autumn.headers.get("cache-control") || "", /max-age/);
  const none = await guest.req("/api/v1/promo/seasonal?season=summer");
  assert.equal(none.json.promo, null);
  const { createClient } = await import("@supabase/supabase-js");
  const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data, error } = await anon.from("promo_redemptions").select("*").limit(5);
  assert.ok(error || (data || []).length === 0, "гость не видит учёт применений");
});
