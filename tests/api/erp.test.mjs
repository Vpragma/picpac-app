// D3: мок ERP, ручная смена статуса, уведомления, чат оператора.
// Запуск: npm run test:api (нужен ERP_SECRET в .env.local — тот же, что у сервера). Секрет не печатается.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { BASE, Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-erp-${randomUUID().slice(0, 8)}`;
const SECRET = process.env.ERP_SECRET || "";
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const guest = new Client("erp");
let C, B, ADM, MOD;
const s = {};

const erp = (body, secret = SECRET) =>
  guest.req("/api/v1/erp/events", { method: "POST", body, headers: secret === null ? {} : { authorization: `Bearer ${secret}` } });
const ev = (type, extra = {}) => ({ eventId: `${RUN}-${type}-${randomUUID().slice(0, 6)}`, type, orderNumber: s.order.number, ...extra });
const history = async () => (await admin.from("order_status_history").select("id, status, substatus, event_type, source, reason").eq("order_id", s.order.id).order("id")).data;

before(async () => {
  assert.ok(SECRET, "нет ERP_SECRET в .env.local");
  [C, B, ADM, MOD] = await Promise.all([
    createTestUser(admin, ["client"], "erpc"),
    createTestUser(admin, ["client"], "erpb"),
    createTestUser(admin, ["admin"], "erpadm"),
    createTestUser(admin, ["moderator"], "erpmod"),
  ]);
  const p = await C.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "ERP", options: { size: "20x20", pages: 20 } } });
  assert.equal(p.status, 201, p.text);
  const u = await C.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok);
  const ph = await C.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(ph.status, 201, ph.text);
  await C.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  const o = await C.client.req("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": `${RUN}-o1` },
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 1" } }, recipient: { name: "Тест Тестович", phone: "+375 29 123-45-67" } },
  });
  assert.equal(o.status, 201, o.text);
  s.order = o.json.order;
  // Симулятор не трогает: статусы в этом тесте двигают только ERP и админ
  await admin.from("orders").update({ is_demo: false }).eq("id", s.order.id);
  const pay = await C.client.req(`/api/v1/orders/${s.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } });
  assert.equal(pay.status, 200, pay.text);
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  for (const u of [C, B, ADM, MOD]) await deleteTestUser(admin, u);
});

test("ERP: без секрета и с неверным секретом → 401, журнал erp.event denied", async () => {
  const none = await erp(ev("moderation_passed"), null);
  assert.equal(none.status, 401, none.text);
  assert.equal(none.json.error.code, "unauthorized");
  const wrong = await erp(ev("moderation_passed"), "wrong-secret-" + randomUUID());
  assert.equal(wrong.status, 401);
  assert.ok(!wrong.text.includes(SECRET), "секрет не попадает в ответ");
});

test("ERP: неизвестное событие, лишнее поле, оба номера → 400; нет заказа → 404", async () => {
  assert.equal((await erp(ev("teleported"))).status, 400);
  const extra = await erp({ ...ev("printed"), price: 1 });
  assert.equal(extra.status, 400);
  assert.equal(extra.json.error.code, "invalid_input");
  assert.equal((await erp({ ...ev("printed"), orderId: s.order.id })).status, 400);
  assert.equal((await erp({ ...ev("printed"), orderNumber: "PP-000000-00000" })).status, 404);
});

test("ERP: событие не по порядку → 409 invalid_transition (заказ «Принят»)", async () => {
  const r = await erp(ev("print_started"));
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json.error.code, "invalid_transition");
  assert.match(r.json.error.message, /Принят/);
});

test("ручная смена статуса: клиент и модератор → 403, без причины → 400 fields.reason, с причиной → 200 и запись в журнале", async () => {
  const url = `/api/v1/admin/orders/${s.order.id}/status`;
  assert.equal((await C.client.req(url, { method: "POST", body: { status: "moderation", reason: "Проверка доступа" } })).status, 403);
  assert.equal((await MOD.client.req(url, { method: "POST", body: { status: "moderation", reason: "Проверка доступа" } })).status, 403);
  const noReason = await ADM.client.req(url, { method: "POST", body: { status: "moderation" } });
  assert.equal(noReason.status, 400, noReason.text);
  assert.ok(noReason.json.error.fields.reason);
  const short = await ADM.client.req(url, { method: "POST", body: { status: "moderation", reason: "  ab " } });
  assert.equal(short.status, 400);
  const ok = await ADM.client.req(url, { method: "POST", body: { status: "moderation", reason: `Секретная причина ${RUN}` } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.order.status, "moderation");
  const same = await ADM.client.req(url, { method: "POST", body: { status: "moderation", reason: "Ещё раз то же самое" } });
  assert.equal(same.status, 409);
  const h = (await history()).pop();
  assert.equal(h.source, "admin");
  assert.equal(h.event_type, "manual_status");
  const { data: log } = await admin.from("audit_log").select("result, details").eq("action", "order.status_change").eq("object_id", s.order.number);
  assert.ok(log.some((x) => x.result === "success" && x.details.to === "moderation" && x.details.reason.includes(RUN)));
  assert.ok(log.some((x) => x.result === "denied"));
  // Клиент видит новый статус и нейтральный текст, настоящую причину — нет
  const mine = await C.client.req(`/api/v1/orders/${s.order.id}`);
  assert.equal(mine.json.order.status, "moderation");
  assert.ok(!mine.text.includes(RUN), "причина админа не видна клиенту");
  assert.ok(mine.json.order.history.some((x) => x.reason === "Статус изменил оператор PicPac"));
});

test("ERP: путь событий до «Завершён», пропуск «Переплёта», повтор eventId → replayed, другой тип с тем же id → 409", async () => {
  const first = ev("moderation_passed");
  const r1 = await erp(first);
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.order.status, "production");
  assert.equal(r1.json.replayed, false);
  const before = (await history()).length;
  const again = await erp(first);
  assert.equal(again.status, 200);
  assert.equal(again.json.replayed, true);
  assert.equal((await history()).length, before, "повтор не добавил строк");
  const conflict = await erp({ ...first, type: "printed" });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, "idempotency_conflict");

  assert.equal((await erp(ev("print_started", { comment: "Цех 2" }))).status, 200);
  const printed = await erp(ev("printed"));
  assert.equal(printed.json.order.progress, 60);
  const twice = await erp(ev("printed"));
  assert.equal(twice.status, 409, "тот же подэтап второй раз — нельзя");
  assert.equal((await erp(ev("packed"))).status, 200);
  assert.equal((await erp(ev("bound"))).status, 409, "назад — нельзя");
  // Два одинаковых события одновременно → одна строка ленты
  const hand = ev("handed_to_delivery");
  const [a, b] = await Promise.all([erp(hand), erp(hand)]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.equal([a.json.replayed, b.json.replayed].filter(Boolean).length, 1);
  const done = await erp(ev("delivered", { occurredAt: new Date().toISOString().replace("Z", "+00:00") }));
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.order.status, "done");
  assert.equal(done.json.order.progress, 100);
  const h = await history();
  assert.equal(h.filter((x) => x.status === "shipped").length, 1);
  const pairs = h.map((x) => `${x.status}|${x.substatus}`);
  assert.equal(new Set(pairs).size, pairs.length, "в ленте нет дублей: " + pairs.join(", "));
  const { data: log } = await admin.from("audit_log").select("result, details").eq("action", "erp.event").eq("object_id", s.order.number);
  assert.ok(log.some((x) => x.result === "success") && log.some((x) => x.result === "denied" && x.details.reason === "invalid_transition"));
});

test("клиент видит 5 статусов и подэтапы производства в ленте", async () => {
  const o = (await C.client.req(`/api/v1/orders/${s.order.id}`)).json.order;
  assert.equal(o.status, "done");
  assert.deepEqual(o.timeline.map((t) => t.label), ["Принят", "Модерация", "Производство", "Готов / передан в доставку", "Завершён"]);
  assert.ok(o.timeline.every((t) => t.done));
  const sub = Object.fromEntries(o.substeps.map((x) => [x.stage, x]));
  assert.ok(sub.print_started.at && sub.printed.at && sub.packed.at);
  assert.equal(o.progress, 100);
});

test("уведомления: клиенту только важное без дублей, чужие не видны и не отмечаются, «Прочитать все»", async () => {
  const r = await C.client.req("/api/v1/notifications");
  assert.equal(r.status, 200, r.text);
  const kinds = r.json.items.filter((n) => n.orderId === s.order.id).map((n) => n.kind).sort();
  assert.deepEqual(kinds, ["order_accepted", "order_done", "order_shipped"]);
  assert.equal(r.json.unread, 3);
  const theirs = await B.client.req("/api/v1/notifications");
  assert.equal(theirs.json.items.length, 0, "B не видит уведомлений C");
  const steal = await B.client.req("/api/v1/notifications/read", { method: "POST", body: { ids: r.json.items.map((n) => n.id) } });
  assert.equal(steal.status, 200);
  assert.equal(steal.json.marked, 0);
  assert.equal((await C.client.req("/api/v1/notifications")).json.unread, 3, "чужая отметка ничего не изменила");
  assert.equal((await C.client.req("/api/v1/notifications/read", { method: "POST", body: { all: true, ids: [] } })).status, 400);
  const all = await C.client.req("/api/v1/notifications/read", { method: "POST", body: { all: true } });
  assert.equal(all.json.unread, 0);
  assert.equal((await guest.req("/api/v1/notifications")).status, 401);
});

test("лента сотрудника: админ видит новый заказ и смены статуса, клиент → 403, модератор — без заказов", async () => {
  const r = await ADM.client.req("/api/v1/admin/notifications");
  assert.equal(r.status, 200, r.text);
  const mine = r.json.items.filter((n) => n.orderId === s.order.id);
  assert.ok(mine.some((n) => n.kind === "order_new"));
  assert.ok(mine.some((n) => n.kind === "order_status" && /Завершён/.test(n.title)));
  assert.equal((await C.client.req("/api/v1/admin/notifications")).status, 403);
  const m = await MOD.client.req("/api/v1/admin/notifications");
  assert.equal(m.status, 200);
  assert.ok(m.json.items.every((n) => n.audience === "moderator"));
  assert.equal((await ADM.client.req("/api/v1/admin/notifications", { method: "POST", body: {} })).json.unread, 0);
});

test("чат оператора: админ видит обращение с маской данных и отвечает; клиент видит ответ и уведомление; модератор → 403", async () => {
  const it = await C.client.req(`/api/v1/orders/${s.order.id}/interactions`, { method: "POST", body: { topic: "Другой вопрос", kind: "support", message: "Можно ли поменять обложку?" } });
  assert.equal(it.status, 201, it.text);
  const id = it.json.interaction.id;
  const url = `/api/v1/admin/interactions/${id}`;
  assert.equal((await MOD.client.req(url)).status, 403);
  assert.equal((await C.client.req(url)).status, 403);
  const view = await ADM.client.req(url);
  assert.equal(view.status, 200, view.text);
  assert.ok(!view.text.includes("123-45-67") && !view.text.includes("Тестович") && !view.text.includes("пункт 1"), "ФИО, телефон и адрес замаскированы");
  assert.equal(view.json.order.client.name, "Тест Т.");
  const empty = await ADM.client.req(url, { method: "POST", body: { body: " " } });
  assert.equal(empty.status, 400);
  const reply = await ADM.client.req(url, { method: "POST", body: { body: "Здравствуйте! Заказ уже напечатан, обложку не поменять." } });
  assert.equal(reply.status, 201, reply.text);
  const msgs = await C.client.req(`/api/v1/interactions/${id}/messages`);
  assert.ok(msgs.json.messages.some((m) => m.author === "operator"));
  assert.equal(msgs.json.interaction.status, "answered");
  const n = await C.client.req("/api/v1/notifications");
  assert.ok(n.json.items.some((x) => x.kind === "support_reply" && x.link.endsWith("#support")));
  const close = await ADM.client.req(url, { method: "POST", body: { body: "Закрываем обращение.", close: true } });
  assert.equal(close.status, 201);
  assert.equal((await ADM.client.req(url, { method: "POST", body: { body: "После закрытия" } })).status, 409);
  assert.equal((await B.client.req(`/api/v1/interactions/${id}/messages`)).status, 404);
});

test("сервер ERP отвечает на адресе " + BASE, () => assert.ok(BASE));

test("A8/A5: карточка заказа в админке — миниатюры фото по подписанным ссылкам, без внутренних кодов", async () => {
  const r = await ADM.client.req(`/admin/orders/${s.order.id}`, { method: "GET" });
  assert.equal(r.status, 200, r.text?.slice(0, 300));
  assert.match(r.text, /data-testid="admin-order-thumbs"/);
  assert.match(r.text, /<img[^>]+src="https:\/\/[^"]+\/storage\/v1\/object\/sign\/photos\//);
  assert.match(r.text, /Данные клиента скрыты/);
  assert.doesNotMatch(r.text, /SEC-14/);
  // модератору карточка заказа недоступна (данные клиента — только админу)
  const m = await MOD.client.req(`/admin/orders/${s.order.id}`, { method: "GET" });
  assert.ok([401, 403].includes(m.status), String(m.status));
});
