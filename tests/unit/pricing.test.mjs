// Unit-тесты формул: цена книг и фото, коэффициенты размеров, промокоды, доставка, сроки по Минску.
// Запуск: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPromo, bookUnitKop, calcTotals, deliveryKop, etaRange, formatByn, linePrice, minskDate, pagesValid, sizeK } from "../../lib/pricing.js";

const lite = { kind: "book", basePriceKop: 7000, per2PagesKop: 200, minPages: 24, maxPages: 160, pageStep: 2, sizes: [{ code: "20x20", k: 1 }, { code: "26x26", k: sizeK(26, 26) }, { code: "21x30", k: sizeK(21, 30) }] };
const classic = { kind: "book", basePriceKop: 8100, per2PagesKop: 300, minPages: 20, maxPages: 60, pageStep: 2, sizes: [{ code: "20x20", k: 1 }, { code: "21x30", k: sizeK(21, 30) }] };
const premium = { kind: "book", basePriceKop: 10050, per2PagesKop: 700, minPages: 10, maxPages: 60, pageStep: 2, sizes: [{ code: "20x20", k: 1 }, { code: "30x30", k: sizeK(30, 30) }] };
const photo = { kind: "print", sizes: [{ code: "10x15", unitPriceKop: 130 }, { code: "30x45", unitPriceKop: 2000 }] };

const europost = { code: "europost", priceKop: 590, freeFromKop: null };
const belpost = { code: "belpost", priceKop: 690, freeFromKop: 15000 };
const ems = { code: "ems", priceKop: 2090, freeFromKop: 30000 };

const TEST10 = { code: "TEST10", kind: "percent", value: 10, minTotalKop: 0, active: true };
const FREESHIP = { code: "FREESHIP", kind: "free_delivery", value: 0, minTotalKop: 0, active: true };
const PICPAC5 = { code: "PICPAC5", kind: "amount", value: 500, minTotalKop: 5000, active: true };
const OLD = { code: "OLD2025", kind: "percent", value: 15, minTotalKop: 0, validTo: "2025-12-31T23:59:59+03:00", active: true };

test("проверочные значения из superpicpac.md: Classic 60 = 141,00; Lite 160 = 206,00; Premium 60 = 275,50", () => {
  assert.equal(bookUnitKop(classic, 60), 14100);
  assert.equal(bookUnitKop(lite, 160), 20600);
  assert.equal(bookUnitKop(premium, 60), 27550);
});

test("минимум страниц = базовая цена", () => {
  assert.equal(bookUnitKop(lite, 24), 7000);
  assert.equal(bookUnitKop(classic, 20), 8100);
  assert.equal(bookUnitKop(premium, 10), 10050);
});

test("коэффициенты размеров: 20×20 → 1, больше площадь — дороже", () => {
  assert.equal(sizeK(20, 20), 1);
  assert.equal(sizeK(21, 30), 1.345);
  assert.equal(sizeK(26, 26), 1.414);
  assert.equal(sizeK(30, 30), 1.75);
  assert.ok(sizeK(30, 20) > 1 && sizeK(30, 20) < sizeK(30, 30));
});

test("цена книги с коэффициентом округляется до 0,10", () => {
  // Classic 60 стр., 21×30: 141,00 × 1,345 = 189,645 → 189,60
  assert.equal(bookUnitKop(classic, 60, sizeK(21, 30)), 18960);
  // Premium 10 стр., 30×30: 100,50 × 1,75 = 175,875 → 175,90
  assert.equal(bookUnitKop(premium, 10, sizeK(30, 30)), 17590);
  assert.equal(bookUnitKop(lite, 24, sizeK(26, 26)) % 10, 0);
});

test("страницы: только чётные от минимума и в пределах продукта", () => {
  assert.ok(pagesValid(classic, 20));
  assert.ok(pagesValid(classic, 60));
  assert.ok(!pagesValid(classic, 21));
  assert.ok(!pagesValid(classic, 18));
  assert.ok(!pagesValid(classic, 62));
});

test("строка корзины: книга × количество, фото × число фото × комплекты", () => {
  assert.deepEqual(linePrice(classic, { sizeCode: "20x20", pages: 60, quantity: 2 }), { unitKop: 14100, count: 1, lineKop: 28200 });
  assert.deepEqual(linePrice(photo, { sizeCode: "10x15", photoCount: 10, quantity: 1 }), { unitKop: 1300, count: 10, lineKop: 1300 });
  assert.equal(linePrice(photo, { sizeCode: "30x45", photoCount: 2, quantity: 3 }).lineKop, 12000);
  assert.equal(linePrice(classic, { sizeCode: "99x99", pages: 20 }), null);
  assert.equal(linePrice(classic, { sizeCode: "20x20", pages: 23 }), null);
});

test("надбавка опций прибавляется к цене единицы (книга и фото)", () => {
  const withCover = { ...classic, options: { cover: [{ id: "gloss", priceDeltaKop: 0 }, { id: "leather", priceDeltaKop: 1500 }] } };
  assert.equal(linePrice(withCover, { sizeCode: "20x20", pages: 20, quantity: 2, options: { cover: "leather" } }).lineKop, (8100 + 1500) * 2);
  assert.equal(linePrice(withCover, { sizeCode: "20x20", pages: 20, options: { cover: "gloss" } }).unitKop, 8100);
  const glossy = { ...photo, options: { surface: [{ id: "matte", priceDeltaKop: 10 }] } };
  assert.equal(linePrice(glossy, { sizeCode: "10x15", photoCount: 3, options: { surface: "matte" } }).lineKop, (130 + 10) * 3);
});

test("промокод TEST10: −10%", () => {
  const r = applyPromo(TEST10, 14100);
  assert.equal(r.ok, true);
  assert.equal(r.discountKop, 1410);
  assert.equal(r.message, "Промокод применён");
});

test("промокод PICPAC5: −5,00 от 50,00, ниже порога — «Не подходит»", () => {
  assert.equal(applyPromo(PICPAC5, 5000).discountKop, 500);
  const low = applyPromo(PICPAC5, 4999);
  assert.equal(low.ok, false);
  assert.equal(low.reason, "min_total");
  assert.match(low.message, /^Не подходит/);
  assert.match(low.message, /50,00 BYN/);
});

test("истёкший промокод — «Истёк», несуществующий — «Не подходит»", () => {
  const old = applyPromo(OLD, 10000, new Date("2026-11-11T12:00:00Z"));
  assert.equal(old.ok, false);
  assert.equal(old.reason, "expired");
  assert.match(old.message, /^Истёк/);
  assert.equal(applyPromo(null, 10000).reason, "not_found");
  assert.equal(applyPromo({ ...TEST10, active: false }, 10000).ok, false);
});

test("доставка: порог бесплатной считается от суммы после скидки", () => {
  assert.equal(deliveryKop(belpost, 15000), 0);
  assert.equal(deliveryKop(belpost, 14999), 690);
  assert.equal(deliveryKop(europost, 99999), 590);
  assert.equal(deliveryKop(ems, 30000), 0);
  assert.equal(deliveryKop(europost, 100, true), 0);
});

test("итог: товары → скидка → доставка → итого", () => {
  // 160,00 с TEST10 = 144,00 < 150,00 → Белпочта платная 6,90 → 150,90
  const lines = [{ lineKop: 16000 }];
  const t = calcTotals({ lines, method: belpost, promo: TEST10 });
  assert.equal(t.goodsKop, 16000);
  assert.equal(t.discountKop, 1600);
  assert.equal(t.deliveryKop, 690);
  assert.equal(t.totalKop, 15090);
  // Без промокода 160,00 ≥ 150,00 → доставка бесплатно
  assert.equal(calcTotals({ lines, method: belpost }).totalKop, 16000);
  // FREESHIP: доставка 0 при любой сумме
  const f = calcTotals({ lines: [{ lineKop: 1300 }], method: ems, promo: FREESHIP });
  assert.equal(f.deliveryKop, 0);
  assert.equal(f.totalKop, 1300);
  // Неподходящий промокод не меняет сумму
  const bad = calcTotals({ lines: [{ lineKop: 1000 }], method: europost, promo: PICPAC5 });
  assert.equal(bad.discountKop, 0);
  assert.equal(bad.totalKop, 1590);
});

test("сроки считаются по Минску (UTC+3), а не по UTC", () => {
  // 11 ноября 22:30 UTC — в Минске уже 12 ноября 01:30
  const now = new Date("2026-11-11T22:30:00Z");
  assert.equal(minskDate(now), "2026-11-12");
  // Книга (3 дня) + Европочта (2–3 дня) → 17–18 ноября
  assert.deepEqual(etaRange(now, 3, 2, 3), { from: "2026-11-17", to: "2026-11-18" });
  // Переход через месяц
  assert.deepEqual(etaRange(new Date("2026-11-28T10:00:00Z"), 2, 1, 2), { from: "2026-12-01", to: "2026-12-02" });
});

test("формат денег: 14100 → «141,00 BYN» (одна валюта во всём приложении)", () => {
  assert.equal(formatByn(14100), "141,00 BYN");
  assert.equal(formatByn(61), "0,61 BYN");
});
