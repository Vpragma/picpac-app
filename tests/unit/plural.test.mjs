// Склонение после числа (тексты продукта и каталога, D2/UI)
import { test } from "node:test";
import assert from "node:assert/strict";
import { plural } from "../../lib/plural.js";

test("plural: 1, 21, 1181 — первая форма; 2–4, 22 — вторая; 5–20, 11–14, 25 — третья", () => {
  const f = ["точка", "точки", "точек"];
  assert.equal(plural(1, f), "точка");
  assert.equal(plural(21, f), "точка");
  assert.equal(plural(1181, f), "точка");
  assert.equal(plural(3, f), "точки");
  assert.equal(plural(22, f), "точки");
  assert.equal(plural(5, f), "точек");
  assert.equal(plural(11, f), "точек");
  assert.equal(plural(14, f), "точек");
  assert.equal(plural(112, f), "точек");
  assert.equal(plural(25, f), "точек");
  assert.equal(plural(0, f), "точек");
});
