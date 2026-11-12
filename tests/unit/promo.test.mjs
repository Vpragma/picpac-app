// Unit-тесты правил промокодов (N8): скидка только на подходящие продукты, минимальная сумма, сроки, сезон,
// лимиты всего и на клиента, личные коды, тексты ошибок. Запуск: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { calcTotals } from "../../lib/pricing.js";
import { benefitText, checkPromo, normalizeCode, productsText, promoDate, shapePromo } from "../../lib/promo.js";

const BOOKS = ["pages-book", "layflat", "photopaper-book"];
const PRODUCTS = [
  { slug: "pages-book", name: "Lite", kind: "book" },
  { slug: "layflat", name: "Classic", kind: "book" },
  { slug: "photopaper-book", name: "Premium", kind: "book" },
  { slug: "photo", name: "Печать фото", kind: "print" },
];
const NOW = new Date("2026-11-12T20:00:00Z");
const OSEN = { code: "OSEN2026", kind: "percent", value: 15, minTotalKop: 0, validFrom: "2026-09-01T00:00:00+03:00", validTo: "2026-11-30T23:59:59+03:00", active: true, productSlugs: BOOKS, season: "autumn" };
const MIXED = [
  { slug: "layflat", lineKop: 8100 },
  { slug: "photo", lineKop: 1300 },
];
const europost = { code: "europost", priceKop: 590, freeFromKop: null };

test("процент — только от подходящих продуктов: книга 81,00 + фото 13,00, −15% на книги → 12,15", () => {
  const r = checkPromo(OSEN, { lines: MIXED, now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.eligibleKop, 8100);
  assert.equal(r.discountKop, 1215);
  const t = calcTotals({ lines: MIXED, method: europost, promo: OSEN, now: NOW });
  assert.equal(t.goodsKop, 9400);
  assert.equal(t.discountKop, 1215);
  assert.equal(t.totalKop, 9400 - 1215 + 590);
});

test("сумма — не больше подходящих позиций; без slug позиции подходят все (старые вызовы)", () => {
  const amount = { code: "MINUS", kind: "amount", value: 5000, active: true, productSlugs: ["photo"] };
  assert.equal(checkPromo(amount, { lines: MIXED, now: NOW }).discountKop, 1300);
  assert.equal(checkPromo(amount, { lines: [{ lineKop: 8100 }], now: NOW }).discountKop, 5000);
  assert.equal(checkPromo(amount, { goodsKop: 2000, now: NOW }).discountKop, 2000);
});

test("«не для этого продукта»: в корзине нет подходящих — понятный текст с названиями", () => {
  const r = checkPromo(OSEN, { lines: [{ slug: "photo", lineKop: 1300 }], now: NOW, products: PRODUCTS });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "wrong_product");
  assert.equal(r.message, "Не для этого продукта: код действует только на фотокниги Lite, Classic, Premium.");
  assert.equal(productsText(["layflat", "photo"], PRODUCTS), "фотокнигу Classic и Печать фото");
});

test("минимальная сумма — по подходящим позициям, текст «минимальная сумма — N BYN» и сколько добавить", () => {
  const big = { code: "BIGBOOK30", kind: "amount", value: 3000, minTotalKop: 20000, active: true, productSlugs: BOOKS };
  const r = checkPromo(big, { lines: MIXED, now: NOW, products: PRODUCTS });
  assert.equal(r.reason, "min_total");
  assert.match(r.message, /^Не подходит: минимальная сумма заказа на фотокниги Lite, Classic, Premium — 200,00 BYN\. Добавьте ещё 119,00 BYN\.$/);
  const ok = checkPromo(big, { lines: [{ slug: "layflat", lineKop: 20000 }], now: NOW });
  assert.equal(ok.discountKop, 3000);
});

test("сроки: «ещё не действует» и «истёк» — с датами по Минску", () => {
  const future = { ...OSEN, validFrom: "2026-12-01T00:00:00+03:00", validTo: null, season: null };
  assert.equal(checkPromo(future, { lines: MIXED, now: NOW }).message, "Не подходит: промокод начнёт действовать 1 декабря 2026.");
  const old = { ...OSEN, validFrom: null, validTo: "2025-08-31T23:59:59+03:00", season: null };
  const r = checkPromo(old, { lines: MIXED, now: NOW });
  assert.equal(r.reason, "expired");
  assert.equal(r.message, "Истёк: промокод действовал до 31 августа 2025.");
  // Последняя секунда дня по Минску ещё действует
  const edge = checkPromo({ ...OSEN }, { lines: MIXED, now: new Date("2026-11-30T20:59:58Z") });
  assert.equal(edge.ok, true);
  assert.equal(promoDate("2026-11-30T20:59:59Z"), "30 ноября 2026");
});

test("выключенный код и неизвестный код", () => {
  assert.equal(checkPromo({ ...OSEN, active: false }, { lines: MIXED, now: NOW }).reason, "disabled");
  assert.equal(checkPromo(null).reason, "not_found");
});

test("сезон: известен и другой — «не тот сезон»; неизвестен (нет N2) — не мешает; совпал — работает", () => {
  const r = checkPromo(OSEN, { lines: MIXED, now: NOW, season: "newyear" });
  assert.equal(r.reason, "season_off");
  assert.match(r.message, /сезона «Осень»/);
  assert.equal(checkPromo(OSEN, { lines: MIXED, now: NOW, season: "none" }).reason, "season_off");
  assert.equal(checkPromo(OSEN, { lines: MIXED, now: NOW, season: null }).ok, true);
  assert.equal(checkPromo(OSEN, { lines: MIXED, now: NOW, season: "autumn" }).ok, true);
  assert.equal(checkPromo({ ...OSEN, season: null }, { lines: MIXED, now: NOW, season: "blackfriday" }).ok, true);
});

test("лимиты: всего исчерпан, на клиента 1 и 3, без usage — не проверяются", () => {
  const p = { code: "LIM", kind: "percent", value: 10, active: true, maxUses: 5, maxUsesPerUser: 1 };
  assert.equal(checkPromo(p, { goodsKop: 1000, usage: { total: 5, mine: 0 } }).reason, "limit");
  const mine = checkPromo(p, { goodsKop: 1000, usage: { total: 2, mine: 1 } });
  assert.equal(mine.reason, "limit_user");
  assert.match(mine.message, /^Код уже использован/);
  assert.match(checkPromo({ ...p, maxUsesPerUser: 3 }, { goodsKop: 1000, usage: { total: 3, mine: 3 } }).message, /3 раза/);
  assert.equal(checkPromo(p, { goodsKop: 1000, usage: { total: 4, mine: 0 } }).ok, true);
  assert.equal(checkPromo(p, { goodsKop: 1000 }).ok, true);
});

test("личный код: гость — «войдите», чужой — «другого клиента», использованный — «уже использован», свой — работает", () => {
  const card = shapePromo({ code: "PPABCDEFGH", kind: "percent", value: 10, min_total_kop: 0, active: true, owner_user_id: "u1", max_uses: 1, max_uses_per_user: 1, source_order_id: "o1" });
  assert.equal(card.personal, true);
  assert.equal(checkPromo(card, { goodsKop: 8100, userId: null }).reason, "login_required");
  assert.equal(checkPromo(card, { goodsKop: 8100, userId: "u2" }).reason, "not_yours");
  assert.equal(checkPromo(card, { goodsKop: 8100, userId: "u1", usage: { total: 1, mine: 1 } }).reason, "used");
  assert.equal(checkPromo(card, { goodsKop: 8100, userId: "u1", usage: { total: 0, mine: 0 } }).discountKop, 810);
  // Экран (userId не передан) владельца не проверяет — это делает сервер
  assert.equal(checkPromo(card, { goodsKop: 8100 }).ok, true);
});

test("бесплатная доставка по коду и сопутствующие функции", () => {
  const free = { code: "FREESHIP", kind: "free_delivery", value: 0, active: true };
  const t = calcTotals({ lines: [{ lineKop: 1300, slug: "photo" }], method: europost, promo: free, now: NOW });
  assert.equal(t.deliveryKop, 0);
  assert.equal(t.totalKop, 1300);
  assert.equal(benefitText(OSEN), "−15%");
  assert.equal(benefitText({ kind: "amount", value: 1000 }), "−10,00 BYN");
  assert.equal(benefitText(free), "бесплатная доставка");
  assert.equal(normalizeCode(" osen2026 "), "OSEN2026");
  assert.equal(normalizeCode("o s"), null);
  assert.equal(normalizeCode("<script>"), null);
});
