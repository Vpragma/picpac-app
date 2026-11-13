// День 3, задача 1: полоса «до бесплатной доставки» в корзине. Границы, тексты и согласованность со строкой
// «Доставка» в итоге (calcTotals): полоса никогда не пишет «бесплатна», если доставка платная, и наоборот.
import assert from "node:assert/strict";
import { test } from "node:test";
import { freeDeliveryMessage, freeDeliveryProgress } from "../../lib/freeDelivery.js";
import { calcTotals, formatByn } from "../../lib/pricing.js";

// Как в каталоге (GET /api/v1/catalog → delivery): пороги есть только у Белпочты и EMS
const DELIVERY = [
  { code: "europost", name: "Европочта", priceKop: 590, freeFromKop: null },
  { code: "belpost", name: "Белпочта", priceKop: 690, freeFromKop: 15000 },
  { code: "ems", name: "EMS", priceKop: 2090, freeFromKop: 30000 },
  { code: "courier-minsk", name: "Курьер Европочты по Минску", priceKop: 1490, freeFromKop: null },
  { code: "courier-by", name: "Курьер Европочты по Беларуси", priceKop: 1990, freeFromKop: null },
];
const TEST10 = { code: "TEST10", kind: "percent", value: 10, minTotalKop: 0, active: true };
const FREESHIP = { code: "FREESHIP", kind: "free_delivery", value: 0, minTotalKop: 0, active: true };

function bar(sumKop, freeByPromo = false, code = "") {
  const p = freeDeliveryProgress(DELIVERY, sumKop, freeByPromo);
  const m = freeDeliveryMessage(p, code);
  return { p, m, text: (m.ok ? "✓ " : "") + m.before + (m.amountKop != null ? formatByn(m.amountKop) : "") };
}

test("границы: 0; 149,99; 150; 299,99; 300 BYN", () => {
  const cases = [
    [0, "first", 15000, 0, "До бесплатной доставки Белпочтой осталось 150,00 BYN"],
    [14999, "first", 1, 14999 / 15000, "До бесплатной доставки Белпочтой осталось 0,01 BYN"],
    [15000, "next", 15000, 0.5, "Доставка Белпочтой бесплатна. До бесплатной EMS осталось 150,00 BYN"],
    [29999, "next", 1, 29999 / 30000, "Доставка Белпочтой бесплатна. До бесплатной EMS осталось 0,01 BYN"],
    [30000, "done", 0, 1, "✓ Доставка EMS бесплатна"],
  ];
  for (const [sum, state, left, fill, text] of cases) {
    const b = bar(sum);
    assert.equal(b.p.state, state, `состояние при ${sum}`);
    assert.equal(b.p.leftKop, left, `осталось при ${sum}`);
    assert.ok(Math.abs(b.p.fill - fill) < 1e-9, `заполнение при ${sum}`);
    assert.equal(b.text, text);
  }
});

test("примеры из задания: 70, 180 и 320 BYN", () => {
  const b70 = bar(7000);
  assert.equal(b70.text, "До бесплатной доставки Белпочтой осталось 80,00 BYN");
  assert.ok(b70.p.fill > 0.45 && b70.p.fill < 0.5, "чуть меньше половины");
  assert.equal(bar(18000).text, "Доставка Белпочтой бесплатна. До бесплатной EMS осталось 120,00 BYN");
  const b320 = bar(32000);
  assert.equal(b320.text, "✓ Доставка EMS бесплатна");
  assert.equal(b320.p.fill, 1);
  assert.equal(b320.m.ok, true);
});

test("пороги — только из данных: без способов с порогом полосы нет, другой порог — другой текст", () => {
  assert.equal(freeDeliveryProgress(DELIVERY.filter((d) => d.freeFromKop == null), 5000), null);
  assert.equal(freeDeliveryProgress([], 5000), null);
  const one = DELIVERY.map((d) => (d.code === "belpost" ? { ...d, freeFromKop: 10000 } : d));
  const p = freeDeliveryProgress(one, 7000);
  assert.equal(p.leftKop, 3000);
  assert.equal(p.method.code, "belpost");
});

test("промокод с бесплатной доставкой: полоса полная, «бесплатна по промокоду»", () => {
  const b = bar(5000, true, "FREESHIP");
  assert.equal(b.p.state, "promo");
  assert.equal(b.p.fill, 1);
  assert.equal(b.text, "✓ Доставка бесплатна по промокоду FREESHIP");
});

test("согласованность со строкой «Доставка» (calcTotals): та же сумма после скидки, с промокодом на границе порога", () => {
  const belpost = DELIVERY.find((d) => d.code === "belpost");
  const ems = DELIVERY.find((d) => d.code === "ems");
  // 162,00 BYN без кода — Белпочта бесплатна; с −10 % = 145,80 — платная, полоса снова «осталось 4,20 BYN»
  const lines = [{ lineKop: 16200 }];
  const plain = calcTotals({ lines, method: belpost, promo: null });
  const withCode = calcTotals({ lines, method: belpost, promo: TEST10 });
  assert.equal(plain.deliveryKop, 0);
  assert.equal(bar(plain.goodsKop - plain.discountKop).p.state, "next");
  assert.equal(withCode.deliveryKop, 690);
  assert.equal(bar(withCode.goodsKop - withCode.discountKop).text, "До бесплатной доставки Белпочтой осталось 4,20 BYN");
  // Перебор сумм вокруг порогов, с кодом и без: «бесплатна» на полосе ⇔ deliveryKop === 0 в итоге
  for (const promo of [null, TEST10, FREESHIP]) {
    for (let goods = 13000; goods <= 34000; goods += 37) {
      for (const method of [belpost, ems]) {
        const t = calcTotals({ lines: [{ lineKop: goods }], method, promo });
        const b = freeDeliveryProgress(DELIVERY, t.goodsKop - t.discountKop, !!(t.promo?.ok && t.promo.freeDelivery));
        const barFree = method.code === "belpost" ? ["next", "done", "promo"].includes(b.state) : ["done", "promo"].includes(b.state);
        assert.equal(barFree, t.deliveryKop === 0, `${promo?.code || "без кода"}, ${goods} коп., ${method.code}`);
      }
    }
  }
});
