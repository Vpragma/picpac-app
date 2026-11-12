// Unit-тесты статистики админки: медиана, воронка с конверсией, «где бросают», подпись источника.
// Запуск: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFunnel, buildSteps, fmtDuration, median, pct, sourceLabel } from "../../lib/analyticsCore.js";

test("медиана: нечётное, чётное, пустое, мусор", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([NaN, 10, null, 20]), 15);
});

test("процент: один знак, деление на ноль → null", () => {
  assert.equal(pct(1, 3), 33.3);
  assert.equal(pct(5, 0), null);
});

test("воронка: конверсия каждого шага и «из корзины оплатили»", () => {
  const f = buildFunnel({ product_view: 1000, project_create: 400, cart_add: 200, checkout_start: 150, payment_test: 120 });
  assert.deepEqual(
    f.steps.map((s) => [s.key, s.n, s.fromPrev]),
    [
      ["product_view", 1000, null],
      ["project_create", 400, 40],
      ["cart_add", 200, 50],
      ["checkout_start", 150, 75],
      ["payment_test", 120, 80],
    ],
  );
  assert.equal(f.cartToPaid, 60);
  assert.equal(f.steps[4].fromFirst, 12);
  assert.ok(f.steps.every((s) => s.formula.length > 10), "у каждого шага есть формула");
  // Пустые данные не ломают расчёт
  const empty = buildFunnel({});
  assert.equal(empty.cartToPaid, null);
  assert.equal(empty.steps[1].fromPrev, null);
});

test("шаги редактора: медиана в секундах и шаг, где чаще бросают", () => {
  const s = buildSteps({ photos: [60000, 120000, 90000], layout: [30000, 50000], edits: [], check: [10000] }, { photos: 5, layout: 12, edits: 3 });
  assert.deepEqual(
    s.rows.map((r) => [r.key, r.medianSec, r.samples, r.dropped]),
    [
      ["photos", 90, 3, 5],
      ["layout", 40, 2, 12],
      ["edits", null, 0, 3],
      ["check", 10, 1, 0],
    ],
  );
  assert.equal(s.worst.key, "layout");
  assert.equal(s.rows[1].dropShare, 60);
  assert.equal(buildSteps({}, {}).worst, null);
});

test("подписи: длительность и источник данных", () => {
  assert.equal(fmtDuration(95), "1 мин 35 с");
  assert.equal(fmtDuration(40), "40 с");
  assert.equal(fmtDuration(null), "—");
  assert.equal(sourceLabel({ synthetic: { events: 10, orders: 0 } }), "демо-данные");
  assert.equal(sourceLabel({ synthetic: { events: 0, orders: 0 } }), "реальные");
});
