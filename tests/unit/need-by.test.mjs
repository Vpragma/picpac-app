// День 3, задача 2: «Нужно к дате» на странице товара — успевает / не успевает / ближайшая возможная.
// «Сегодня» фиксировано — 13 ноября 2026 по Минску; сроки — из etaFromDay (печать 3 дня + дни способа, как в каталоге).
import assert from "node:assert/strict";
import { test } from "node:test";
import { needByCheck } from "../../lib/needBy.js";
import { etaFromDay, formatEtaRange, minskDate } from "../../lib/pricing.js";

// Порядок и дни — как в каталоге (GET /api/v1/catalog → delivery)
const DELIVERY = [
  { code: "europost", name: "Европочта", minDays: 2, maxDays: 3 },
  { code: "belpost", name: "Белпочта", minDays: 2, maxDays: 3 },
  { code: "ems", name: "EMS", minDays: 1, maxDays: 2 },
  { code: "courier-minsk", name: "Курьер Европочты по Минску", minDays: 1, maxDays: 2 },
  { code: "courier-by", name: "Курьер Европочты по Беларуси", minDays: 1, maxDays: 3 },
];
const TODAY = "2026-11-13";
const rows = (today = TODAY, printDays = 3) => DELIVERY.map((d) => ({ ...d, ...etaFromDay(today, printDays, d.minDays, d.maxDays) }));

test("сроки фотокниги от 13 ноября: EMS и курьер по Минску 17–18, Европочта и Белпочта 18–19, курьер по Беларуси 17–19", () => {
  const r = Object.fromEntries(rows().map((d) => [d.code, formatEtaRange(d.from, d.to)]));
  assert.deepEqual(r, { europost: "18–19 ноября", belpost: "18–19 ноября", ems: "17–18 ноября", "courier-minsk": "17–18 ноября", "courier-by": "17–19 ноября" });
});

test("18 ноября: успевают EMS и курьер по Минску, остальные — нет", () => {
  const c = needByCheck(rows(), "2026-11-18", TODAY);
  assert.equal(c.invalid, false);
  assert.deepEqual(c.fits, { europost: false, belpost: false, ems: true, "courier-minsk": true, "courier-by": false });
  assert.equal(c.anyFits, true);
  assert.equal(c.earliest, null);
});

test("последний день срока = выбранной дате — успевает; на день раньше — нет", () => {
  const c19 = needByCheck(rows(), "2026-11-19", TODAY);
  assert.ok(Object.values(c19.fits).every(Boolean));
  const c17 = needByCheck(rows(), "2026-11-17", TODAY);
  assert.ok(Object.values(c17.fits).every((x) => !x));
});

test("15 ноября: не успевает никто — ближайшая 18 ноября (EMS); при равном сроке — первый способ по каталогу", () => {
  const c = needByCheck(rows(), "2026-11-15", TODAY);
  assert.equal(c.anyFits, false);
  assert.equal(c.earliest.to, "2026-11-18");
  assert.equal(c.earliest.name, "EMS");
  assert.equal(`К этой дате не успеем. Ближайшая возможная — ${formatEtaRange(c.earliest.to, c.earliest.to)} (${c.earliest.name})`, "К этой дате не успеем. Ближайшая возможная — 18 ноября (EMS)");
});

test("дата не выбрана → как раньше; прошлая (iOS пропустил min) и не дата → неверная", () => {
  assert.equal(needByCheck(rows(), "", TODAY), null);
  assert.equal(needByCheck(rows(), "2026-11-12", TODAY).invalid, true);
  assert.equal(needByCheck(rows(), "18.11.2026", TODAY).invalid, true);
  assert.equal(needByCheck(rows(), TODAY, TODAY).invalid, false, "сегодня — можно");
});

test("«сегодня» — календарная дата по Минску: 23:30 UTC 12 ноября в Минске уже 13-е", () => {
  const today = minskDate(new Date("2026-11-12T21:30:00Z"));
  assert.equal(today, "2026-11-13");
  assert.equal(needByCheck(rows(today), "2026-11-12", today).invalid, true);
  assert.deepEqual(needByCheck(rows(today), "2026-11-18", today).fits.ems, true);
});
