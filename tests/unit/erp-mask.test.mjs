// D3: порядок событий ERP (сверка с SQL миграции 0007), готовность, сравнение секрета, маски SEC-14.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ERP_EVENTS, eventAllowed, progressFor } from "../../lib/erp.js";
import { bearer, safeEqual } from "../../lib/server/secret.js";
import { initials, maskAddress, maskClient, maskEmail, maskName, maskPhone } from "../../lib/mask.js";

test("ERP: порядок событий совпадает с рангами в SQL (0007)", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0007_erp_notifications.sql", import.meta.url), "utf8");
  const ranks = [...sql.matchAll(/when '([a-z_]+)' then (\d)/g)].filter(([, , n]) => Number(n) >= 1 && Number(n) <= 7);
  const order = ranks.slice(0, 7).sort((a, b) => a[2] - b[2]).map(([, name]) => name);
  assert.deepEqual(order, ERP_EVENTS);
});

test("ERP: допустимые переходы — вперёд по подэтапам, назад и повтор нельзя", () => {
  assert.equal(eventAllowed("moderation_passed", "moderation", null), true);
  assert.equal(eventAllowed("print_started", "accepted", null), false);
  assert.equal(eventAllowed("packed", "production", "printed"), true, "переплёт можно пропустить");
  assert.equal(eventAllowed("printed", "production", "printed"), false, "повтор подэтапа");
  assert.equal(eventAllowed("bound", "production", "packed"), false, "назад");
  assert.equal(eventAllowed("delivered", "production", "packed"), false);
  assert.equal(eventAllowed("delivered", "shipped", "handed_to_delivery"), true);
  assert.equal(eventAllowed("unknown", "production", null), false);
});

test("готовность: 5 → 15 → 30…85 → 95 → 100", () => {
  assert.equal(progressFor("accepted"), 5);
  assert.equal(progressFor("moderation"), 15);
  assert.equal(progressFor("production", null), 30);
  assert.equal(progressFor("production", "printed"), 60);
  assert.equal(progressFor("shipped", "handed_to_delivery"), 95);
  assert.equal(progressFor("done", "delivered"), 100);
});

test("секрет: сравнение равных, разной длины и пустых", () => {
  assert.equal(safeEqual("abc-123", "abc-123"), true);
  assert.equal(safeEqual("abc-123", "abc-1234"), false);
  assert.equal(safeEqual("", ""), false);
  assert.equal(safeEqual(null, "x"), false);
  const h = new Headers({ authorization: "Bearer s3cr3t" });
  assert.equal(bearer(h), "s3cr3t");
  assert.equal(bearer(new Headers({ authorization: "Basic s3cr3t" })), "");
  assert.equal(bearer(new Headers()), "");
});

test("SEC-14: маски имени, телефона, почты и адреса", () => {
  assert.equal(maskName("Тест Тестович"), "Тест Т.");
  assert.equal(initials("Тест Тестович"), "Т. Т.");
  const phone = maskPhone("+375 (29) 123-45-67");
  assert.match(phone, /^\+375 /);
  assert.ok(phone.endsWith("67"));
  assert.ok(phone.replace(/^\+375/, "").replace(/\D/g, "").length <= 2, "после кода страны видно не больше 2 цифр: " + phone);
  assert.equal(maskEmail("ivan@example.com"), "i•••@example.com");
  assert.equal(maskAddress({ city: "Минск", street: "Ленина", house: "1" }), "г. Минск");
  assert.equal(maskAddress({ pickup_point: "Минск, пункт 1" }), "Пункт выдачи (скрыт)");
  const mod = maskClient({ recipient: { name: "Тест Тестович", phone: "+375291234567", email: "t@e.by" }, delivery_address: { city: "Минск" } }, "moderator");
  assert.equal(mod.name, "Т. Т.");
  assert.equal(mod.address, undefined, "модератор не видит адрес");
  assert.ok(!JSON.stringify(mod).includes("1234567"));
});

test("D4: пороги цензуры — граница не включается, мусор не даёт флага", async () => {
  const { needsModeration, RETURN_REASONS } = await import("../../lib/moderation.js");
  assert.equal(needsModeration({ porn: 0.6, hentai: 0.1, sexy: 0 }), false, "ровно 0,7 — не флаг");
  assert.equal(needsModeration({ porn: 0.6, hentai: 0.1001, sexy: 0 }), true);
  assert.equal(needsModeration({ porn: 0, hentai: 0, sexy: 0.85 }), false);
  assert.equal(needsModeration({ porn: 0, hentai: 0, sexy: 0.8501 }), true);
  assert.equal(needsModeration(null), false);
  assert.equal(needsModeration({ porn: NaN, hentai: "x", sexy: undefined }), false);
  assert.ok(RETURN_REASONS.quality && Object.keys(RETURN_REASONS).length === 6);
});

test("бот поддержки: «Где мой заказ?» — статус, готовность и дата по данным заказа; иное — срок ответа оператора", async () => {
  const { botReply, etaText } = await import("../../lib/supportBot.js");
  const order = { number: "PP-261112-10001", status: "production", substatus: "Печать", erp_stage: "print_started", eta_from: "2026-11-16T21:00:00Z", eta_to: "2026-11-17T21:00:00Z" };
  const r = botReply({ topic: "Где мой заказ?", order, slaText: "13 ноября в 12:00" });
  assert.match(r.body, /^Обращение по заказу PP-261112-10001 получено\./);
  assert.match(r.body, /«Производство» — Печать, готовность 45 %/);
  assert.match(r.body, /17–18 ноября/);
  assert.equal(etaText("2026-11-29T21:00:00Z", "2026-12-01T21:00:00Z"), "30 ноября – 2 декабря");
  const other = botReply({ topic: "Другой вопрос", order, slaText: "13 ноября в 12:00" });
  assert.match(other.body, /Обращение по заказу PP-261112-10001 получено\. Оператор ответит до 13 ноября в 12:00\./);
});

test("бот поддержки: заявка на перепечатку — причина и срок ответа оператора", async () => {
  const { botReply } = await import("../../lib/supportBot.js");
  const order = { number: "PP-261112-10002", status: "done" };
  const r = botReply({ topic: "Перепечатка: ошибка в макете", order, slaText: "13 ноября в 12:00" });
  assert.match(r.body, /^Обращение по заказу PP-261112-10002 получено\. Заявка на перепечатку, причина: ошибка в макете\./);
  assert.match(botReply({ topic: "Перепечатка: брак печати", order, slaText: "x" }).body, /брак печати.*Сфотографируйте брак/);
});
