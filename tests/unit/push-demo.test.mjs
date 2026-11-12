// D9: результат отправки пуша (201 — принято, 404/410 — подписка удалена), шаблоны демо-пушей, текст «под кнопкой».
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoPushText, NEXT_STATUS, pushOutcome, pushResultText, pushServiceName } from "../../lib/notifyRules.js";
import { sendToSubscriptions } from "../../lib/pushSend.js";

// Подмена базы: запоминает, что обновили и что удалили
function fakeDb() {
  const log = { updated: [], deleted: [] };
  const db = {
    from: () => ({
      update: (row) => ({ eq: async (_c, id) => log.updated.push({ id, row }) }),
      delete: () => ({ eq: async (_c, id) => log.deleted.push(id) }),
    }),
  };
  return { db, log };
}
const sub = (id, host) => ({ id, endpoint: `https://${host}/push/${id}`, p256dh: "k", auth: "a" });
const keys = { publicKey: "p", privateKey: "s", subject: "mailto:x@example.com" };

test("ответ push-сервиса: 201 — принято, 404 и 410 — удалить подписку, 429/500 — оставить", () => {
  assert.deepEqual(pushOutcome(201), { ok: true, remove: false, status: 201 });
  assert.equal(pushOutcome(410).remove, true);
  assert.equal(pushOutcome(404).remove, true);
  assert.equal(pushOutcome(429).remove, false);
  assert.equal(pushOutcome(500).ok, false);
  assert.equal(pushServiceName("web.push.apple.com"), "Apple");
  assert.equal(pushServiceName("fcm.googleapis.com"), "Google");
});

test("отправка: 201 отмечает доставку, 410 удаляет подписку, чужой хост не трогаем, в лог — без адреса подписки", async () => {
  const { db, log } = fakeDb();
  const calls = [];
  const send = async (s) => {
    calls.push(s.endpoint);
    if (s.endpoint.includes("/dead")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    return { statusCode: 201 };
  };
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(" "));
  try {
    const r = await sendToSubscriptions(db, [sub("ok1", "fcm.googleapis.com"), sub("dead", "web.push.apple.com"), sub("x", "evil.example.com")], { title: "PicPac", body: "Тест" }, { keys, send });
    assert.equal(r.sent, 1);
    assert.equal(r.failed, 1);
    assert.equal(r.removed, 1);
    assert.deepEqual(r.results, [
      { service: "Google", ok: true, status: 201 },
      { service: "Apple", ok: false, status: 410 },
    ]);
  } finally {
    console.error = orig;
  }
  assert.equal(calls.length, 2, "на чужой хост не отправляем");
  assert.deepEqual(log.deleted, ["dead"]);
  assert.equal(log.updated[0].id, "ok1");
  assert.ok(log.updated[0].row.last_ok_at);
  assert.ok(errors.every((e) => !e.includes("/push/")), "адреса подписки нет в логе");
  assert.ok(errors.some((e) => e.includes("web.push.apple.com") && e.includes("410")));
});

test("шаблоны демо-пушей: корзина из настоящих товаров, заказ — следующий статус, ссылки только свои", () => {
  assert.equal(demoPushText("test").title, "PicPac: уведомления работают");
  const c = demoPushText("cart", { products: ["Фотокнига Classic 21×30", "Фотокнига Mini"] });
  assert.equal(c.body, "В корзине: Фотокнига Classic 21×30 и ещё 1. Оформим?");
  assert.equal(c.url, "/cart");
  assert.equal(demoPushText("cart", { products: ["Фотокнига Classic 21×30"] }).body, "В корзине: Фотокнига Classic 21×30. Оформим?");
  const o = demoPushText("advance", { number: "PP-251112-0001", orderId: "abc", status: "production" });
  assert.equal(o.body, "Заказ №PP-251112-0001 передан в производство");
  assert.equal(o.url, "/orders/abc");
  assert.equal(NEXT_STATUS.accepted, "production");
  assert.equal(NEXT_STATUS.done, undefined);
});

test("текст под кнопкой: принято сервисом, нет устройств, нет ключей, ошибка с кодом", () => {
  assert.equal(pushResultText([{ service: "Apple", ok: true, status: 201 }]), "Принято сервисом Apple: 1 из 1 устройства");
  assert.equal(pushResultText([]), "Нет подписанных устройств — включите уведомления в профиле на телефоне.");
  assert.match(pushResultText([], { noVapid: true }), /VAPID/);
  assert.equal(pushResultText([{ service: "Google", ok: false, status: 403 }]), "Не принято сервисом Google: 0 из 1 устройства (ошибка 403)");
});
