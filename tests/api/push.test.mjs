// D5 (S09): пуш-подписки (SSRF, чужая подписка, отвязка при выходе) и одно напоминание о забытой корзине.
// Тестовые пользователи e2e-…@example.com удаляются после тестов. Запуск: npm run test:api (BASE_URL — сервер).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, test } from "node:test";
import { BASE, Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const guest = new Client("гость");
let U; // клиент с подпиской и корзиной
let V; // другой клиент
let A; // админ

before(async () => {
  [U, V, A] = await Promise.all([createTestUser(admin, ["client"], "push"), createTestUser(admin, ["client"], "push2"), createTestUser(admin, ["admin"], "pushadm")]);
});

after(async () => {
  await Promise.all([deleteTestUser(admin, U), deleteTestUser(admin, V), deleteTestUser(admin, A)]);
});

// Похоже на настоящую подписку Chrome: адрес FCM и ключи нужной длины (65 и 16 байт в base64url)
const fakeSub = () => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomBytes(12).toString("hex")}`,
  expirationTime: null,
  keys: { p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") },
});

test("подписка: гость 401, чужой хост 400, лишнее поле 400, чужой сайт 403", async () => {
  assert.equal((await guest.req("/api/v1/push/subscriptions", { method: "POST", body: fakeSub() })).status, 401);
  for (const endpoint of ["https://localhost/x", "http://fcm.googleapis.com/x", "https://169.254.169.254/latest/meta-data", "https://fcm.googleapis.com.evil.com/x"]) {
    const r = await U.client.req("/api/v1/push/subscriptions", { method: "POST", body: { ...fakeSub(), endpoint } });
    assert.equal(r.status, 400, endpoint);
  }
  assert.equal((await U.client.req("/api/v1/push/subscriptions", { method: "POST", body: { ...fakeSub(), extra: 1 } })).status, 400);
  const foreign = await U.client.req("/api/v1/push/subscriptions", { method: "POST", body: fakeSub(), headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 403);
});

test("подписка: сохраняется за пользователем и сессией, без полного User-Agent; чужую удалить нельзя; выход отвязывает", async () => {
  const sub = fakeSub();
  const ua = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
  const r = await U.client.req("/api/v1/push/subscriptions", { method: "POST", body: sub, headers: { "user-agent": ua } });
  assert.equal(r.status, 200, r.text);
  const { data: rows } = await admin.from("push_subscriptions").select("user_id, session_id, device, user_agent").eq("endpoint", sub.endpoint);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, U.id);
  assert.ok(rows[0].session_id, "привязана к сессии входа");
  assert.equal(rows[0].device, "Android · Chrome");
  assert.equal(rows[0].user_agent, null, "полный User-Agent не храним");

  // Другой пользователь не может удалить чужую подписку
  const del = await V.client.req("/api/v1/push/subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } });
  assert.equal(del.status, 200, del.text);
  assert.equal(del.json.removed, 0);
  const { count: still } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("endpoint", sub.endpoint);
  assert.equal(still, 1, "чужая подписка на месте");

  // Выход: подписка этой сессии удаляется на сервере
  const out = await U.client.req("/api/v1/auth/logout", { method: "POST" });
  assert.equal(out.status, 200);
  const { count: left } = await admin.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("endpoint", sub.endpoint);
  assert.equal(left, 0, "после выхода подписки нет");
  // Снова войти — для следующих тестов
  const again = await U.client.req("/api/v1/auth/login", { method: "POST", body: { email: U.email, password: U.password } });
  assert.equal(again.status, 200);
});

test("расписание: без секрета и с неверным секретом — 401", async () => {
  assert.equal((await guest.req("/api/v1/cron/cart-reminders", { method: "POST", body: {} })).status, 401);
  assert.equal((await guest.req("/api/v1/cron/cart-reminders", { method: "POST", body: {}, headers: { authorization: "Bearer " + "x".repeat(40) } })).status, 401);
  assert.equal((await guest.req("/api/v1/cron/cart-reminders")).status, 401);
});

test("кнопка админки: клиент 403; забытая корзина — ровно одно напоминание, повтор не шлёт второе", async () => {
  assert.equal((await U.client.req("/api/v1/admin/cart-reminders", { method: "POST", body: {} })).status, 403);
  const p = await U.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { size: "20x20", pages: 20, settings: { quantity: 1 } } } });
  assert.equal(p.status, 201, p.text);
  const put = await U.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  assert.equal(put.status, 200, put.text);
  // Состарить СВОЮ корзину на 3 суток и убрать тихие часы у этого пользователя (общую задержку не трогаем)
  const old = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  // Сеть медленная, база общая — проверяем каждую запись, а не надеемся на неё
  const must = async (q, what) => {
    const { error } = await q;
    assert.equal(error, null, `${what}: ${error?.message}`);
  };
  await must(admin.from("cart_items").update({ updated_at: old }).eq("user_id", U.id), "состарить корзину");
  await must(admin.from("projects").update({ updated_at: old }).eq("id", p.json.project.id), "состарить проект");
  await must(admin.from("notification_settings").upsert({ user_id: U.id, quiet_from: "00:00", quiet_to: "00:00" }, { onConflict: "user_id" }), "без тихих часов");
  const { data: cart } = await admin.from("cart_items").select("updated_at, projects(status, updated_at)").eq("user_id", U.id);
  assert.equal(cart.length, 1, "в корзине одна позиция");
  assert.ok(Date.parse(cart[0].updated_at) < Date.now() - 2 * 24 * 3600 * 1000 && cart[0].projects.status === "in_cart", JSON.stringify(cart));

  const first = await A.client.req("/api/v1/admin/cart-reminders", { method: "POST", body: {} });
  assert.equal(first.status, 200, first.text);
  assert.ok(first.json.due >= 1, first.text);
  const count = async () => (await admin.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", U.id).eq("kind", "cart_reminder")).count;
  assert.equal(await count(), 1, "одно напоминание в центре уведомлений");
  const { data: n } = await admin.from("notifications").select("title, body, link").eq("user_id", U.id).eq("kind", "cart_reminder").single();
  assert.equal(n.link, "/cart");
  assert.match(n.body, /ждёт в корзине/);

  const second = await A.client.req("/api/v1/admin/cart-reminders", { method: "POST", body: {} });
  assert.equal(second.status, 200, second.text);
  assert.equal(await count(), 1, "повторный запуск не создал второе напоминание");
  const { count: claims } = await admin.from("cart_reminders").select("id", { count: "exact", head: true }).eq("user_id", U.id);
  assert.equal(claims, 1);
});

test("задержка напоминания: только 5, 60, 1440 минут; без лишних полей", async () => {
  const g = await A.client.req("/api/v1/admin/cart-reminders");
  assert.equal(g.status, 200, g.text);
  assert.ok([5, 60, 1440].includes(g.json.afterMinutes));
  assert.equal((await A.client.req("/api/v1/admin/cart-reminders", { method: "PUT", body: { afterMinutes: 7 } })).status, 400);
  assert.equal((await A.client.req("/api/v1/admin/cart-reminders", { method: "PUT", body: { afterMinutes: 60, x: 1 } })).status, 400);
  assert.equal((await A.client.req("/api/v1/admin/cart-reminders", { method: "POST", body: { force: true } })).status, 400);
  // Ставим то же значение, что было, — общую настройку не меняем
  const same = await A.client.req("/api/v1/admin/cart-reminders", { method: "PUT", body: { afterMinutes: g.json.afterMinutes } });
  assert.equal(same.status, 200, same.text);
  assert.ok(BASE);
});
