// D9: доказательство доставки пуша до системного уведомления — в НАСТОЯЩЕМ Chrome (не Chromium Playwright:
// у него нет push-сервиса Google). Постоянный профиль, разрешение уведомлений выдано заранее.
// Шаги: временный клиент e2e-… входит в Chrome → включает уведомления в профиле → админ (тоже временный) жмёт
// «Тестовый пуш», «Напомнить о корзине сейчас», «Продвинуть последний заказ на шаг» → в странице
// registration.getNotifications() показывает уведомление с нужным текстом. Временные аккаунты удаляются.
// Запуск: BASE_URL=https://<превью> node --env-file-if-exists=.env.local scripts/push-proof.mjs
// Пароли временных аккаунтов случайные и не печатаются.
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { BASE, createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-pushproof-${randomUUID().slice(0, 8)}`;
const JPEG = readFileSync(new URL("../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function waitNotification(page, test, timeout = 45000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const list = await page.evaluate(() =>
      navigator.serviceWorker.ready.then((r) => r.getNotifications()).then((ns) => ns.map((n) => ({ title: n.title, body: n.body, tag: n.tag, url: n.data && n.data.url, badge: n.badge, icon: n.icon }))),
    );
    const hit = list.find(test);
    if (hit) return { hit, ms: Date.now() - t0 };
    await sleep(1000);
  }
  return { hit: null, ms: Date.now() - t0 };
}

const results = [];
let U;
let A;
let ctx;
try {
  [U, A] = await Promise.all([createTestUser(admin, ["client"], "pushproof"), createTestUser(admin, ["admin"], "pushproofadm")]);
  log("временные аккаунты созданы");
  // Постоянный профиль: регистрация Chrome в push-сервисе Google сохраняется между запусками
  const profile = join(tmpdir(), "picpac-push-proof-chrome");
  mkdirSync(profile, { recursive: true });
  ctx = await chromium.launchPersistentContext(profile, { channel: "chrome", headless: false, viewport: { width: 1280, height: 800 } });
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(BASE + "/help");
  const login = await page.evaluate(
    ([email, password]) => fetch("/api/v1/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) }).then((r) => r.status),
    [U.email, U.password],
  );
  log("вход в Chrome:", login);
  // Подписка браузера могла остаться от прошлого запуска (постоянный профиль) — начинаем с чистого листа
  await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => s && s.unsubscribe()));
  await page.goto(BASE + "/profile");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.getByRole("button", { name: "Сообщать о заказах и важном" }).click();
  await page.getByText("Включены на этом устройстве").waitFor({ timeout: 90000 });
  const { data: subs } = await admin.from("push_subscriptions").select("device, endpoint").eq("user_id", U.id);
  log("подписка:", subs?.length, subs?.map((s) => s.device + " @ " + new URL(s.endpoint).hostname).join(", "));

  const demo = (action) => A.client.req("/api/v1/admin/push-demo", { method: "POST", body: { action, email: U.email } });

  // 1. Тестовый пуш
  let r = await demo("test");
  log("Тестовый пуш:", r.status, r.json?.text);
  let w = await waitNotification(page, (n) => n.title === "PicPac: уведомления работают");
  results.push({ step: "test", api: r.json?.text, shown: w.hit, ms: w.ms });
  log("  уведомление:", w.hit ? `«${w.hit.title}» за ${w.ms} мс, url ${w.hit.url}` : "НЕ ПОЯВИЛОСЬ");

  // 2. Корзина: проект в корзине клиента
  const p = await U.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Пуш", options: { size: "20x20", pages: 20 } } });
  const up = await U.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  await fetch(up.json.upload.url, { method: "PUT", headers: up.json.upload.headers, body: JPEG });
  await U.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: up.json.upload.path } });
  await U.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  await sleep(10500);
  r = await demo("cart");
  log("Напомнить о корзине:", r.status, r.json?.body, "|", r.json?.text);
  w = await waitNotification(page, (n) => /^В корзине: .+ Оформим\?$/.test(n.body || ""));
  results.push({ step: "cart", api: r.json?.text, shown: w.hit, ms: w.ms });
  log("  уведомление:", w.hit ? `«${w.hit.body}» за ${w.ms} мс, url ${w.hit.url}` : "НЕ ПОЯВИЛОСЬ");

  // 3. Заказ из этой корзины → «Продвинуть последний заказ на шаг»
  const o = await U.client.req("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": `${RUN}-o1` },
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 1" } }, recipient: { name: "Тест Тестович", phone: "+375 29 123-45-67" } },
  });
  log("заказ:", o.status, o.json?.order?.number);
  if (o.json?.order?.id) {
    await admin.from("orders").update({ is_demo: false }).eq("id", o.json.order.id); // симулятор не трогает
    await U.client.req(`/api/v1/orders/${o.json.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } });
  }
  await sleep(10500);
  r = await demo("advance");
  log("Продвинуть заказ:", r.status, r.json?.body, "|", r.json?.text);
  w = await waitNotification(page, (n) => /^Заказ №.+ (передан в производство|готов и передан в доставку|доставлен)$/.test(n.body || ""));
  results.push({ step: "advance", api: r.json?.text, shown: w.hit, ms: w.ms });
  log("  уведомление:", w.hit ? `«${w.hit.body}» за ${w.ms} мс, url ${w.hit.url}` : "НЕ ПОЯВИЛОСЬ");
} catch (e) {
  log("ошибка:", e?.message);
} finally {
  await ctx?.close().catch(() => {});
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  await Promise.all([deleteTestUser(admin, U), deleteTestUser(admin, A)]);
  log("временные аккаунты удалены");
}
const ok = results.length === 3 && results.every((x) => x.shown);
console.log(JSON.stringify({ base: BASE, ok, results: results.map((x) => ({ step: x.step, api: x.api, title: x.shown?.title, body: x.shown?.body, url: x.shown?.url, ms: x.ms })) }, null, 1));
process.exit(ok ? 0 : 1);
