// Местные правки без нейросетей (S03c): поиск солнца и заливка круга (lib/photo/local.js)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOps, findSun, healCircle, opBox } from "../../lib/photo/local.js";

// Небо-градиент 400×300 с солнцем (белый круг r=14 и ореол) в точке (300, 80)
function sky({ sun = true } = {}) {
  const w = 400;
  const h = 300;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = 90 + y * 0.3;
      let g = 140 + y * 0.25;
      let b = 210 - y * 0.1;
      if (sun) {
        const dist = Math.hypot(x - 300, y - 80);
        const glow = dist < 14 ? 1 : Math.max(0, 1 - (dist - 14) / 12);
        r += (255 - r) * glow;
        g += (250 - g) * glow;
        b += (235 - b) * glow;
      }
      d[i] = r;
      d[i + 1] = g;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  }
  return { d, w, h };
}
const lumAt = (d, w, x, y) => {
  const i = (y * w + x) * 4;
  return 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
};

test("солнце находится: центр рядом с (300, 80), круг захватывает ореол", () => {
  const { d, w, h } = sky();
  const op = findSun(d, w, h);
  assert.ok(op, "солнце не найдено");
  assert.equal(op.kind, "heal");
  assert.ok(Math.abs(op.cx * w - 300) < 6 && Math.abs(op.cy * h - 80) < 6, JSON.stringify(op));
  assert.ok(op.r * w >= 20 && op.r * w < 70, `радиус ${op.r * w}`);
});

test("без яркого пятна солнце не придумывается", () => {
  const { d, w, h } = sky({ sun: false });
  assert.equal(findSun(d, w, h), null);
});

test("заливка убирает солнце: в центре — цвет неба, вне круга пиксели не меняются", () => {
  const { d, w, h } = sky();
  const clean = sky({ sun: false }).d;
  const op = findSun(d, w, h);
  const before = d.slice();
  applyOps(d, w, h, [op]);
  const center = lumAt(d, w, 300, 80);
  const skyL = lumAt(clean, w, 300, 80);
  assert.ok(Math.abs(center - skyL) < 25, `центр ${center.toFixed(0)}, небо ${skyL.toFixed(0)}`);
  // Далеко от круга — без изменений
  for (const [x, y] of [[20, 20], [100, 250], [399, 299]]) {
    const i = (y * w + x) * 4;
    assert.deepEqual([...d.slice(i, i + 3)], [...before.slice(i, i + 3)]);
  }
});

test("область круга в другом масштабе (печатная версия): та же правка по частям кадра", () => {
  const { d, w, h } = sky();
  const op = findSun(d, w, h);
  const box = opBox(op, w, h);
  assert.ok(box.w > 0 && box.h > 0 && box.x + box.w <= w && box.y + box.h <= h);
  // Вырезаем область и правим её как часть кадра
  const part = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) part.set(d.subarray(((box.y + y) * w + box.x) * 4, ((box.y + y) * w + box.x + box.w) * 4), y * box.w * 4);
  healCircle(part, box.w, box.h, op, box.x, box.y, w, h);
  const cx = Math.round(op.cx * w) - box.x;
  const cy = Math.round(op.cy * h) - box.y;
  assert.ok(lumAt(part, box.w, cx, cy) < 200, "в центре области больше нет солнца");
});

test("маленькая яркая точка (фонарь, отблеск) — не солнце, но блик", () => {
  const w = 400;
  const h = 300;
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 40;
    d[i + 1] = 50;
    d[i + 2] = 70;
    d[i + 3] = 255;
  }
  for (let y = 148; y < 153; y++) for (let x = 98; x < 103; x++) d.set([255, 255, 240, 255], (y * w + x) * 4);
  assert.equal(findSun(d, w, h), null);
  const glare = findSun(d, w, h, { minCore: 0 });
  assert.ok(glare && Math.abs(glare.cx * w - 100) < 6, JSON.stringify(glare));
});
