// D4: фото с флагом цензуры → заказ ждёт модератора, очередь, «Одобрить» / «Вернуть на замену» с причиной,
// уведомление клиенту, маски SEC-14, модератор не читает заказы клиентов напрямую (RLS).
// Классификатор подменён: оценки nsfw тест присылает сам (неприличных фото не скачиваем).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-mod-${randomUUID().slice(0, 8)}`;
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const FLAG = { porn: 0.81, hentai: 0.02, sexy: 0.1, neutral: 0.05, drawing: 0.02 };
const CLEAN = { porn: 0.01, hentai: 0.01, sexy: 0.6, neutral: 0.9, drawing: 0.01 };
const SECRET = process.env.ERP_SECRET || "";
let C, MOD, ADM;
const s = {};

async function flaggedOrder(user, key, nsfw = FLAG) {
  const p = await user.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Модерация", options: { size: "20x20", pages: 20 } } });
  assert.equal(p.status, 201, p.text);
  const u = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  assert.ok((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG })).ok);
  const ph = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path, nsfw } });
  assert.equal(ph.status, 201, ph.text);
  await user.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  const o = await user.client.req("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 7" } }, recipient: { name: "Тест Тестович", phone: "+375 29 765-43-21" } },
  });
  assert.equal(o.status, 201, o.text);
  assert.equal((await user.client.req(`/api/v1/orders/${o.json.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } })).status, 200);
  // Как будто с оплаты прошло 10 минут: симулятор догоняет шаги при чтении
  const past = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin.from("orders").update({ status_changed_at: past, paid_at: past }).eq("id", o.json.order.id);
  return { order: o.json.order, photo: ph.json.photo };
}

before(async () => {
  [C, MOD, ADM] = await Promise.all([createTestUser(admin, ["client"], "modc"), createTestUser(admin, ["moderator"], "modm"), createTestUser(admin, ["admin"], "moda")]);
  Object.assign(s, await flaggedOrder(C, `${RUN}-1`));
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  for (const u of [C, MOD, ADM]) await deleteTestUser(admin, u);
});

test("фото с высокими оценками → флаг; заказ с флагом стоит на «Модерации», ERP moderation_passed → 409", async () => {
  assert.equal(s.photo.moderationFlag, true);
  const o = (await C.client.req(`/api/v1/orders/${s.order.id}`)).json.order;
  assert.equal(o.status, "moderation", "дальше без модератора не идёт");
  assert.equal(o.moderation.state, "checking");
  if (SECRET) {
    const r = await new Client("erp").req("/api/v1/erp/events", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
      body: { eventId: `${RUN}-mp`, type: "moderation_passed", orderId: s.order.id },
    });
    assert.equal(r.status, 409, r.text);
    assert.equal(r.json.error.code, "moderation_pending");
  }
});

test("очередь: модератор видит фото по подписанной ссылке и маски, без ФИО, телефона и адреса; клиент → 403", async () => {
  assert.equal((await C.client.req("/api/v1/admin/moderation")).status, 403);
  const q = await MOD.client.req("/api/v1/admin/moderation");
  assert.equal(q.status, 200, q.text);
  const item = q.json.items.find((i) => i.orderId === s.order.id);
  assert.ok(item, "заказ в очереди");
  assert.match(item.url || "", /^https?:/);
  assert.equal(item.client.name, "Т. Т.");
  assert.ok(!q.text.includes("Тестович") && !q.text.includes("765-43-21") && !q.text.includes("пункт 7"), "нет ПДн в ответе");
  s.review = item.id;
});

// N7: числа модерации согласованы. Одинаковое — одним числом: «Фото ждут проверки» в «Обзоре» = очередь модератора
// (и = её списку), «Заказы на модерации» в «Обзоре» = плитка «Статистики» с «Все данные». Синтетические заказы
// двигает ERP-симулятор раз в 30 с, поэтому числа снимаем одновременно и при расхождении снимаем ещё раз.
const tileValue = (html, id) => {
  const m = html.match(new RegExp(`data-testid="tile-${id}"[^>]*data-value="(\\d+)"`)) || html.match(new RegExp(`data-value="(\\d+)"[^>]*data-testid="tile-${id}"`));
  return m ? Number(m[1]) : null;
};

test("счётчики модерации: «Обзор» = очередь модератора = «Статистика», подписи честные", async () => {
  let last;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const [overview, queue, stats] = await Promise.all([
      ADM.client.req("/admin"),
      MOD.client.req("/api/v1/admin/moderation"),
      ADM.client.req("/api/v1/admin/stats?days=7&source=all"),
    ]);
    assert.equal(overview.status, 200);
    assert.equal(queue.status, 200, queue.text);
    assert.equal(stats.status, 200, stats.text);
    const items = queue.json.items;
    const st = queue.json.stats;
    last = {
      photosOverview: tileValue(overview.text, "photos-waiting"),
      ordersOverview: tileValue(overview.text, "orders-moderation"),
      pending: st.pending,
      orders: st.orders,
      listed: items.length,
      listedOrders: new Set(items.map((i) => i.orderId)).size,
      statsOrders: stats.json.tiles.onModeration,
      statsPhotos: stats.json.moderation?.photosWaiting,
    };
    assert.ok(last.pending >= 1, "фото этого теста ждёт модератора");
    assert.ok(items.some((i) => i.orderId === s.order.id));
    // Подписи: фото и заказы — разные вещи, у каждой своё имя
    assert.match(overview.text, /Фото ждут проверки/);
    assert.match(overview.text, /Заказы на модерации/);
    assert.doesNotMatch(overview.text, /Ждут модерации/);
    const same =
      last.photosOverview === last.pending &&
      last.statsPhotos === last.pending &&
      (items.length >= 50 || (last.listed === last.pending && last.listedOrders === last.orders)) &&
      last.ordersOverview === last.statsOrders;
    if (same) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.fail("числа модерации расходятся: " + JSON.stringify(last));
});

// N7 (критик B, серьёзный): требование N4 — на всех экранах сотрудников. Карточка заказа админки показывала
// фото с флагом целиком; теперь — размыто, вывод модели словами и «Показать», решения — словами очереди.
test("карточка заказа админки: фото с флагом размыто, вывод словами и «Показать»; без сырого «автопроверка: true»", async () => {
  const page = await ADM.client.req(`/admin/orders/${s.order.id}`);
  assert.equal(page.status, 200);
  const html = page.text;
  const thumbs = html.slice(html.indexOf('data-testid="admin-order-thumbs"'));
  assert.match(thumbs, /data-flagged="true"/, "миниатюра помечена флагом");
  assert.match(thumbs, /data-blurred="true"/, "фото с флагом размыто до нажатия");
  assert.match(thumbs, /filter:blur\(24px\)/, "то же размытие, что в очереди");
  assert.match(html, /data-testid="staff-photo-show"[^>]*>Показать фото 1</, "кнопка «Показать»");
  assert.match(html, /data-testid="admin-flagged-photos"[\s\S]*Найдено: [^<]+\(высокая уверенность\)/, "вывод модели словами у фото");
  assert.match(html, /data-testid="admin-review-findings"[^>]*>Найдено: /, "блок «Модерация» — словами");
  assert.doesNotMatch(html, /автопроверка: true|Отклонено/, "без сырых значений и второго названия решения");
});

test("модератор не читает заказы и фото клиентов своим ключом (RLS, SEC-14)", async () => {
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: MOD.email, password: MOD.password });
  assert.ok(!error, error?.message);
  const { data: orders } = await sb.from("orders").select("id, recipient").eq("id", s.order.id);
  assert.equal((orders || []).length, 0);
  const { data: photos } = await sb.from("project_photos").select("id").eq("id", s.photo.id);
  assert.equal((photos || []).length, 0);
});

test("«Вернуть на замену»: без причины → 400, с причиной → 200 и уведомление «Нужно заменить фото»; повтор → 409", async () => {
  const url = `/api/v1/admin/moderation/${s.review}`;
  const noReason = await MOD.client.req(url, { method: "POST", body: { decision: "return" } });
  assert.equal(noReason.status, 400, noReason.text);
  assert.ok(noReason.json.error.fields.reason);
  assert.equal((await C.client.req(url, { method: "POST", body: { decision: "approve" } })).status, 403);
  const ok = await MOD.client.req(url, { method: "POST", body: { decision: "return", reason: "quality", comment: "Фото слишком тёмное" } });
  assert.equal(ok.status, 200, ok.text);
  const again = await MOD.client.req(url, { method: "POST", body: { decision: "approve" } });
  assert.equal(again.status, 409);
  const o = (await C.client.req(`/api/v1/orders/${s.order.id}`)).json.order;
  assert.equal(o.status, "moderation");
  assert.equal(o.moderation.state, "needs_replacement");
  assert.equal(o.moderation.returned[0].reasonLabel, "Не подходит для печати");
  const n = await C.client.req("/api/v1/notifications");
  assert.ok(n.json.items.some((x) => x.kind === "photo_replace" && x.title === "Нужно заменить фото"));
  const { data: log } = await admin.from("audit_log").select("result").eq("action", "moderation.return").eq("object_id", s.review);
  assert.ok(log.some((x) => x.result === "success"));
});

test("«Одобрить» → заказ уходит в производство; чистые фото — автоодобрение без модератора", async () => {
  const second = await flaggedOrder(C, `${RUN}-2`);
  assert.equal((await C.client.req(`/api/v1/orders/${second.order.id}`)).json.order.status, "moderation");
  const q = await MOD.client.req("/api/v1/admin/moderation");
  const item = q.json.items.find((i) => i.orderId === second.order.id);
  assert.ok(item);
  const r = await MOD.client.req(`/api/v1/admin/moderation/${item.id}`, { method: "POST", body: { decision: "approve" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.orderStatus, "production");
  const o = (await C.client.req(`/api/v1/orders/${second.order.id}`)).json.order;
  assert.notEqual(o.status, "moderation");
  assert.ok(o.history.some((h) => h.reason === "Модератор проверил фото — можно печатать"));
  const clean = await flaggedOrder(C, `${RUN}-3`, CLEAN);
  assert.equal(clean.photo.moderationFlag, false, "sexy 0,6 — не флаг (порог 0,85)");
  const co = (await C.client.req(`/api/v1/orders/${clean.order.id}`)).json.order;
  assert.ok(["production", "shipped", "done"].includes(co.status), "без флага — автоодобрение: " + co.status);
  assert.ok(co.history.some((h) => /Автоодобрение/.test(h.reason || "")));
});
