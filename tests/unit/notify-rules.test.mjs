// D5: тихие часы, правило напоминания о корзине, адрес подписки (SSRF), содержимое пуша — без сети и базы
import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedEndpoint, cartKeySource, cartReminderText, deviceLabel, dueCarts, isQuietHours, isTestEmail, pushPayload } from "../../lib/notifyRules.js";

const minsk = (hhmm) => new Date(`2026-11-12T${hhmm}:00+03:00`);

test("тихие часы 22:00–09:00 по Минску: границы", () => {
  assert.equal(isQuietHours(new Date("2026-11-12T18:59:00Z")), false); // 21:59 Минск
  assert.equal(isQuietHours(minsk("22:00")), true);
  assert.equal(isQuietHours(minsk("03:00")), true);
  assert.equal(isQuietHours(minsk("08:59")), true);
  assert.equal(isQuietHours(minsk("09:00")), false);
  assert.equal(isQuietHours(minsk("13:00"), "22:00:00", "09:00:00"), false, "время из Postgres");
  assert.equal(isQuietHours(minsk("03:00"), "10:00", "10:00"), false, "from = to — тихих часов нет");
  assert.equal(isQuietHours(minsk("23:00"), "22:00", "09:00", "Нет/Такого"), true, "неизвестный пояс — по Минску");
});

const row = (user, project, updatedMinAgo, now, p = {}) => ({
  user_id: user,
  project_id: project,
  updated_at: new Date(now - updatedMinAgo * 60_000).toISOString(),
  projects: { title: p.title ?? "Лето", product_slug: "classic", status: p.status ?? "in_cart", updated_at: new Date(now - updatedMinAgo * 60_000).toISOString() },
});

test("забытая корзина: кому и когда напомнить", () => {
  const now = minsk("12:00");
  const rows = [row("u1", "p1", 1500, now), row("u2", "p2", 30, now), row("u3", "p3", 2000, now, { status: "ordered" }), row("u4", "p4", 3000, now)];
  const settings = new Map([["u4", { reminders: false }]]);
  const { ready, quiet } = dueCarts(rows, settings, { now, afterMin: 1440 });
  assert.deepEqual(ready.map((u) => u.userId), ["u1"], "свежая, заказанная и отключённая — без напоминания");
  assert.equal(quiet.length, 0);
  const night = dueCarts(rows, settings, { now: minsk("23:30"), afterMin: 1440 });
  assert.deepEqual(night.ready, []);
  assert.deepEqual(night.quiet.map((u) => u.userId), ["u1"], "ночью ждёт утра");
  const demo = dueCarts(rows, settings, { now, afterMin: 5 });
  assert.deepEqual(demo.ready.map((u) => u.userId).sort(), ["u1", "u2"], "демо-задержка 5 минут");
});

test("ключ корзины не зависит от порядка, текст пуша — без названия книги", () => {
  assert.equal(cartKeySource(["b", "a", "b"]), cartKeySource(["a", "b"]));
  const t = cartReminderText({ title: "Свадьба Ивановых", productName: "Classic" });
  assert.match(t.inbox.body, /Свадьба Ивановых/);
  assert.doesNotMatch(t.push.body, /Ивановых/);
  assert.equal(t.push.url, "/cart");
});

test("адрес подписки: только push-сервисы по https (защита от SSRF)", () => {
  assert.equal(allowedEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
  assert.equal(allowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x"), true);
  assert.equal(allowedEndpoint("https://web.push.apple.com/QK"), true);
  assert.equal(allowedEndpoint("https://wns2-db5p.notify.windows.com/w/?token=1"), true);
  for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://localhost/x", "https://169.254.169.254/latest", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://u:p@fcm.googleapis.com/x", "javascript:alert(1)", "", null]) {
    assert.equal(allowedEndpoint(bad), false, String(bad));
  }
});

test("пуш: свой путь, обрезка, метка устройства без полного User-Agent", () => {
  const p = JSON.parse(pushPayload({ title: "x".repeat(100), body: "y".repeat(500), url: "https://evil.com/", tag: "z".repeat(50) }));
  assert.equal(p.title.length, 60);
  assert.equal(p.body.length, 140);
  assert.equal(p.url, "/");
  assert.equal(p.tag.length, 32);
  assert.equal(JSON.parse(pushPayload({ url: "//evil.com" })).url, "/");
  assert.equal(JSON.parse(pushPayload({ url: "/orders/1" })).url, "/orders/1");
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1"), "iPhone/iPad · Safari");
  assert.equal(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"), "Android · Chrome");
});

test("N10: тестовый аккаунт — e2e-…, critic-…, night2-… (зеркало private.is_test_email)", () => {
  for (const e of ["e2e-a-1234@example.com", "E2E-x@example.com", "critic-run1@example.com", "night2-promo@example.com"]) assert.equal(isTestEmail(e), true, e);
  for (const e of ["client@example.com", "admin@example.com", "moderator@example.com", "synthetic-001@example.com", "anna.e2e-@mail.by", "", null, undefined])
    assert.equal(isTestEmail(e), false, String(e));
});

test("N7: напоминание о печати фото — не «книга»", () => {
  const t = cartReminderText({ title: "", productName: "Печать фото", productSlug: "photo" });
  assert.doesNotMatch(t.inbox.title + t.inbox.body + t.push.body, /[Кк]ниг/);
  assert.match(t.inbox.title, /Фото ждут в корзине/);
  const b = cartReminderText({ title: "Свадьба", productName: "Classic", productSlug: "layflat" });
  assert.match(b.inbox.title, /Книга ждёт в корзине/);
});
