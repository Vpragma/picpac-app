// N9: админка сильнее — заказы (фильтры, CSV без персональных данных), пользователи и роли, каталог, журнал без шума.
// Безопасность (N6): клиент и модератор получают 403 на всех новых маршрутах, гость — 401.
// Тестовые аккаунты — свои night2-n9-…@example.com (демо-аккаунты не меняем); после тестов удаляются.
// Каталог: меняем только старую цену «Цифровой печати» и сразу возвращаем как было.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const guest = new Client("гость");
let A; // админ
let M; // модератор
let C; // клиент
let T; // клиент, которому выдаём и снимаем роли
const marker = `night2-n9-group-${randomUUID().slice(0, 8)}`;

async function night2User(roles, label) {
  const email = `night2-n9-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `Night2 ${label}` } });
  if (error) throw new Error("Не создать тестового пользователя: " + error.message);
  const id = data.user.id;
  if (!roles.includes("client")) await admin.from("user_roles").delete().eq("user_id", id).eq("role", "client");
  for (const role of roles.filter((r) => r !== "client")) await admin.from("user_roles").upsert({ user_id: id, role });
  const client = new Client(label);
  const login = await client.req("/api/v1/auth/login", { method: "POST", body: { email, password } });
  if (login.status !== 200) throw new Error(`Вход ${label}: код ${login.status}`);
  return { id, email, client };
}

before(async () => {
  [A, M, C, T] = await Promise.all([night2User(["admin"], "adm"), night2User(["moderator"], "mod"), night2User(["client"], "cli"), night2User(["client"], "tgt")]);
  // Три одинаковые записи подряд (с пометкой test — скрыты в журнале по умолчанию) — для проверки «×3»
  const rows = [1, 2, 3].map(() => ({ action: "access.denied", object_type: "route", object_id: marker, result: "denied", details: { test: "night2-n9-group" }, ip: "10.9.9.9" }));
  for (const r of rows) {
    const { error } = await admin.from("audit_log").insert(r);
    assert.equal(error, null, error?.message);
  }
});

after(async () => {
  await Promise.all([A, M, C, T].map((u) => deleteTestUser(admin, u)));
});

const NEW_ROUTES = (targetId) => [
  ["GET", "/api/v1/admin/orders"],
  ["GET", "/api/v1/admin/orders/export"],
  ["GET", "/api/v1/admin/users"],
  ["POST", `/api/v1/admin/users/${targetId}/roles`, { role: "moderator", grant: true }],
  ["GET", "/api/v1/admin/catalog"],
  ["PATCH", "/api/v1/admin/catalog/digital", { oldPriceKop: null }],
  ["GET", "/api/v1/admin/audit?group=1&days=7&hideTests=1&hideSystem=1&hideErp=1"],
];

test("N9 безопасность: гость — 401, клиент и модератор — 403 на всех новых маршрутах", async () => {
  for (const [method, path, body] of NEW_ROUTES(T.id)) {
    assert.equal((await guest.req(path, { method, body })).status, 401, `гость ${method} ${path}`);
    for (const u of [C, M]) {
      const r = await u.client.req(path, { method, body });
      assert.equal(r.status, 403, `${u.email.split("-")[2]} ${method} ${path}: ${r.text.slice(0, 120)}`);
    }
  }
  // Страницы админки тоже закрыты: модератор не видит заказы, пользователей и каталог
  for (const page of ["/admin/orders", "/admin/users", "/admin/catalog"]) {
    assert.equal((await M.client.req(page)).status, 403, `модератор ${page}`);
    assert.equal((await C.client.req(page)).status, 403, `клиент ${page}`);
  }
  // Роль модератору не выдана — проверка, что 403 ничего не изменил
  const { data } = await admin.from("user_roles").select("role").eq("user_id", T.id);
  assert.deepEqual(data.map((r) => r.role), ["client"]);
});

test("N9 заказы: фильтры, сортировка, страницы, неверный фильтр — 400", async () => {
  const get = (q) => A.client.req(`/api/v1/admin/orders${q ? "?" + q : ""}`);
  const all = await get("");
  assert.equal(all.status, 200, all.text);
  assert.ok(all.json.total >= all.json.items.length && all.json.items.length <= 25);
  const mod = await get("status=moderation&per=10");
  assert.ok(mod.json.items.every((o) => o.status === "moderation"));
  const late = await get("overdue=1");
  assert.ok(late.json.items.every((o) => o.overdue && ["accepted", "moderation", "production"].includes(o.status)));
  const lite = await get("product=pages-book&sort=sum_desc");
  assert.ok(lite.json.items.every((o) => o.products.includes("pages-book")));
  const sums = lite.json.items.map((o) => o.totalKop);
  assert.deepEqual(sums, [...sums].sort((a, b) => b - a), "сумма по убыванию");
  if (all.json.total > 25) {
    const p2 = await get("page=2");
    assert.equal(p2.json.page, 2);
    assert.ok(!p2.json.items.some((o) => all.json.items.find((x) => x.id === o.id)), "вторая страница — другие заказы");
  }
  if (all.json.items[0]) {
    const tail = all.json.items[0].number.slice(-5);
    const found = await get(`q=${tail}`);
    assert.ok(found.json.items.some((o) => o.number === all.json.items[0].number), "поиск по номеру");
  }
  const day = await get("from=2026-11-11&to=2026-11-11");
  assert.ok(day.json.items.every((o) => o.createdAt >= "2026-11-10T21:00:00" && o.createdAt < "2026-11-11T21:00:00"), "день по Минску");
  for (const bad of ["q=%25", "status=lost", "foo=1", "from=11.11.2026", "per=1000"]) assert.equal((await get(bad)).status, 400, bad);
  // Персональных полей в списке нет
  const keys = new Set(all.json.items.flatMap((o) => Object.keys(o)));
  for (const k of ["recipient", "phone", "email", "street", "house", "flat", "delivery_address", "name"]) assert.ok(!keys.has(k), `нет поля ${k}`);
});

test("N9 CSV: только номер, дата, продукт, сумма, статус, город; выгрузка в журнале", async () => {
  const r = await A.client.req("/api/v1/admin/orders/export?status=moderation");
  assert.equal(r.status, 200, r.text.slice(0, 200));
  assert.match(r.headers.get("content-type"), /^text\/csv/);
  assert.match(r.headers.get("content-disposition"), /attachment; filename="picpac-orders-/);
  const lines = r.text.replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lines[0], "Номер;Дата (Минск);Продукт;Сумма, BYN;Статус;Город");
  assert.equal(lines.length - 1, Number(r.headers.get("x-rows")));
  assert.ok(lines.slice(1).every((l) => /^PP-\d{6}-\d{5};\d{2}\.\d{2}\.\d{4} \d{2}:\d{2};/.test(l) && l.split(";").length === 6), "6 столбцов в каждой строке");
  assert.ok(!/@/.test(r.text), "нет почты");
  assert.ok(!/\+?375\s?\(?\d{2}/.test(r.text), "нет телефонов");
  assert.ok(!/ул\.|улица|кв\.|дом /i.test(r.text), "нет адресов");
  const { data } = await admin.from("audit_log").select("result, details").eq("action", "admin.orders_export").eq("user_id", A.id).order("id", { ascending: false }).limit(1);
  assert.equal(data[0]?.result, "success");
  assert.equal(data[0].details.count, lines.length - 1);
  assert.deepEqual(data[0].details.filters, { status: "moderation" });
  // Ссылка с чужого сайта — отказ
  assert.equal((await A.client.req("/api/v1/admin/orders/export", { headers: { referer: "https://evil.example/x" } })).status, 403);
});

test("N9 пользователи: поиск, маска почты, тестовые аккаунты скрыты по умолчанию", async () => {
  const hidden = await A.client.req(`/api/v1/admin/users?q=${encodeURIComponent(T.email)}`);
  assert.equal(hidden.status, 200, hidden.text);
  assert.equal(hidden.json.items.length, 0, "тестовые аккаунты скрыты");
  const r = await A.client.req(`/api/v1/admin/users?q=${encodeURIComponent(T.email)}&tests=1`);
  assert.equal(r.json.items.length, 1);
  const u = r.json.items[0];
  assert.equal(u.id, T.id);
  assert.ok(u.email.includes("•") && !u.email.includes(T.email.split("@")[0]), "почта замаскирована");
  assert.deepEqual(u.roles, ["client"]);
  const staff = await A.client.req("/api/v1/admin/users?role=admin");
  assert.ok(staff.json.items.length >= 1 && staff.json.items.every((x) => x.roles.includes("admin")));
  assert.equal((await A.client.req("/api/v1/admin/users?role=boss")).status, 400);
});

test("N9 роли: выдать и снять — с журналом; свои роли, демо и синтетику — нельзя", async () => {
  const set = (id, body, client = A.client) => client.req(`/api/v1/admin/users/${id}/roles`, { method: "POST", body });
  const g = await set(T.id, { role: "moderator", grant: true });
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.result, "granted");
  assert.deepEqual(g.json.roles, ["client", "moderator"]);
  assert.equal((await set(T.id, { role: "moderator", grant: true })).json.result, "unchanged");
  const rv = await set(T.id, { role: "moderator", grant: false });
  assert.equal(rv.json.result, "revoked");
  assert.deepEqual(rv.json.roles, ["client"]);
  const { data: log } = await admin.from("audit_log").select("action, result, object_id, details").eq("user_id", A.id).in("action", ["admin.role_grant", "admin.role_revoke"]).order("id");
  assert.deepEqual(
    log.filter((x) => x.result === "success").map((x) => [x.action, x.object_id, x.details.role]),
    [
      ["admin.role_grant", T.id, "moderator"],
      ["admin.role_revoke", T.id, "moderator"],
    ],
  );
  // Свою роль — нельзя (значит, и последнего администратора не снять: снимать может только другой админ)
  const self = await set(A.id, { role: "admin", grant: false });
  assert.equal(self.status, 403, self.text);
  assert.equal(self.json.error.code, "self_role");
  assert.equal((await set(A.id, { role: "moderator", grant: true })).status, 403);
  // Роль «Клиент» не меняется, лишние поля и неверная роль — 400, неизвестный id — 404
  assert.equal((await set(T.id, { role: "client", grant: false })).status, 400);
  assert.equal((await set(T.id, { role: "boss", grant: true })).status, 400);
  assert.equal((await set(T.id, { role: "admin", grant: true, extra: 1 })).status, 400);
  assert.equal((await set(randomUUID(), { role: "moderator", grant: true })).status, 404);
  // Демо-аккаунт и синтетика защищены
  const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const demo = users.users.find((u) => u.email === "moderator@example.com" || u.email === "client@example.com");
  if (demo) {
    const d = await set(demo.id, { role: "admin", grant: true });
    assert.equal(d.status, 403, d.text);
    assert.equal(d.json.error.code, "demo_account");
  }
  const { data: syn } = await admin.from("profiles").select("id").eq("is_synthetic", true).limit(1);
  if (syn?.[0]) {
    const s = await set(syn[0].id, { role: "moderator", grant: true });
    assert.equal(s.status, 403);
    assert.equal(s.json.error.code, "synthetic");
  }
  // Чужой сайт — отказ
  assert.equal((await A.client.req(`/api/v1/admin/users/${T.id}/roles`, { method: "POST", body: { role: "moderator", grant: true }, headers: { origin: "https://evil.example" } })).status, 403);
  const { data: final } = await admin.from("user_roles").select("role").eq("user_id", T.id);
  assert.deepEqual(final.map((r) => r.role), ["client"], "у цели снова только «Клиент»");
});

test("N9 каталог: проверки цен, старая цена > текущей, журнал, цена в каталоге клиента", async () => {
  const cat = await A.client.req("/api/v1/admin/catalog");
  assert.equal(cat.status, 200, cat.text);
  const digital = cat.json.products.find((p) => p.slug === "digital");
  assert.ok(digital && digital.priceFromKop > 0);
  const patch = (body, slug = "digital") => A.client.req(`/api/v1/admin/catalog/${slug}`, { method: "PATCH", body });
  // Неверные значения — 400, ничего не меняется
  for (const bad of [{ sizes: [{ code: "10x15", unitPriceKop: -5 }] }, { sizes: [{ code: "10x15", unitPriceKop: 0 }] }, { sizes: [{ code: "10x15", unitPriceKop: 50_000_000 }] }, { basePriceKop: 9000 }, { badge: "хит" }, { foo: 1 }, { sizes: [{ code: "99x99", unitPriceKop: 100 }] }]) {
    const r = await patch(bad);
    assert.equal(r.status, 400, JSON.stringify(bad) + " " + r.text.slice(0, 160));
  }
  const notDiscount = await patch({ oldPriceKop: digital.priceFromKop });
  assert.equal(notDiscount.status, 400);
  assert.equal(notDiscount.json.error.code, "old_price");
  assert.equal((await patch({ sizes: [{ code: "20x20", priceK: 1.5 }] }, "nope-product")).status, 404);
  assert.equal((await patch({ sizes: [{ code: "20x20", priceK: 0.01 }] }, "layflat")).status, 400, "коэффициент вне пределов");
  // Старая цена — и сразу обратно (исходное значение)
  const was = digital.oldPriceKop;
  const target = digital.priceFromKop + 50;
  try {
    const ok = await patch({ oldPriceKop: target });
    assert.equal(ok.status, 200, ok.text);
    assert.deepEqual(ok.json.changed, ["oldPriceKop"]);
    assert.equal(ok.json.product.oldPriceKop, target);
    const pub = await guest.req("/api/v1/catalog");
    const shown = pub.json.products.find((p) => p.slug === "digital");
    assert.equal(shown.oldPriceFromKop, target, "каталог клиента (этот сервер) сразу видит старую цену");
    const { data } = await admin.from("audit_log").select("result, object_id, details").eq("action", "admin.catalog_update").eq("user_id", A.id).eq("result", "success").order("id", { ascending: false }).limit(1);
    assert.equal(data[0].object_id, "digital");
    assert.deepEqual(data[0].details.changes, { oldPriceKop: { from: was, to: target } });
  } finally {
    const back = await patch({ oldPriceKop: was });
    assert.equal(back.status, 200, back.text);
  }
  const same = await patch({ oldPriceKop: was });
  assert.deepEqual(same.json.changed, [], "без изменений — без записи");
});

test("N9 журнал: по умолчанию без автотестов и системных, группировка «×3», быстрые фильтры", async () => {
  const get = (q) => A.client.req(`/api/v1/admin/audit?${q}`);
  const def = await get("group=1&days=7&hideTests=1&hideSystem=1&hideErp=1&limit=50");
  assert.equal(def.status, 200, def.text);
  const items = def.json.groups.flatMap((g) => g.items);
  assert.ok(items.every((i) => i.is_test === false), "автотестов нет");
  assert.ok(items.every((i) => !/^(erp|cron|notify)\./.test(i.action)), "системных и ERP нет");
  const weekAgo = Date.now() - 7 * 86_400_000 - 60_000;
  assert.ok(items.every((i) => new Date(i.at).getTime() >= weekAgo), "за 7 дней");
  assert.ok(!items.some((i) => i.object_id === marker), "тестовые записи скрыты");
  // С автотестами — три одинаковые записи подряд одной группой
  const g = await get(`group=1&objectId=${marker}`);
  assert.equal(g.status, 200, g.text);
  assert.equal(g.json.groups.length, 1);
  assert.equal(g.json.groups[0].count, 3);
  assert.equal(g.json.rows, 3);
  const logins = await get("group=1&quick=logins&limit=20");
  assert.ok(logins.json.groups.flatMap((x) => x.items).every((i) => i.action.startsWith("auth.")));
  const denied = await get("quick=denied&limit=20");
  assert.ok(denied.json.items.every((i) => i.result !== "success"));
  const adminActs = await get(`quick=admin&user=${A.id}&limit=50`);
  assert.ok(adminActs.json.items.length > 0, "действия этого админа есть");
  assert.ok(adminActs.json.items.every((i) => i.action.startsWith("admin.") || ["order.status_change", "interaction.reply"].includes(i.action)));
  assert.equal((await get("quick=everything")).status, 400);
  assert.equal((await get("days=365")).status, 400);
});

test("N9 статистика: период 1/7/30/90 дней, промокоды, синтетика — переключателем", async () => {
  for (const days of [1, 90]) {
    const r = await A.client.req(`/api/v1/admin/stats?days=${days}&source=all`);
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.days, days);
    assert.ok(r.json.promo && r.json.promo.withCode <= r.json.promo.orders, "промокоды посчитаны");
    assert.ok(Array.isArray(r.json.promo.top) && r.json.promo.top.length <= 5);
  }
  const all = await A.client.req("/api/v1/admin/stats?days=90&source=all");
  const real = await A.client.req("/api/v1/admin/stats?days=90&source=real");
  assert.ok(real.json.promo.orders <= all.json.promo.orders, "без синтетики заказов не больше");
  assert.equal((await M.client.req("/api/v1/admin/stats?days=90")).status, 403);
});
