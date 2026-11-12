// Срок готовности и доставки по Минску в карточке продукта (S02a)
import assert from "node:assert/strict";
import { test } from "node:test";
import { daysWord, etaFromDay, formatEtaRange, minskDate } from "../../lib/pricing.js";

test("срок: печать 3 дня + Европочта 2–3 дня от 12 ноября → 17–18 ноября", () => {
  const eta = etaFromDay("2026-11-12", 3, 2, 3);
  assert.deepEqual(eta, { from: "2026-11-17", to: "2026-11-18" });
  assert.equal(formatEtaRange(eta.from, eta.to), "17–18 ноября");
});

test("срок: переход через месяц и одинаковые даты", () => {
  assert.equal(formatEtaRange("2026-11-30", "2026-12-01"), "30 ноября – 1 декабря");
  assert.equal(formatEtaRange("2026-12-05", "2026-12-05"), "5 декабря");
});

test("срок считается по Минску: 23:30 UTC 11 ноября — это уже 12 ноября в Минске", () => {
  assert.equal(minskDate(new Date("2026-11-11T21:30:00Z")), "2026-11-12");
});

test("склонение дней", () => {
  assert.deepEqual([1, 2, 3, 5, 11, 21, 22].map(daysWord), ["1 день", "2 дня", "3 дня", "5 дней", "11 дней", "21 день", "22 дня"]);
});
