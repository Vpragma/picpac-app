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
