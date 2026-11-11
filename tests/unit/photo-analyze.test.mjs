// Анализатор и автоулучшение (S03a) на фото «Тестовой галереи» (public/demo-gallery).
// JPEG раскодирует sharp (идёт вместе с Next.js); снимок уменьшается до 512 точек, как в воркере.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { analyzePixels, problemsFrom, autoParams, findDuplicates, hashDistance, ANALYSIS_SIDE } from "../../lib/photo/analyze.js";
import { applyEdits, applyParams, effectiveParams, addManual, hasAuto, hasManual } from "../../lib/photo/adjust.js";

const sharp = createRequire(import.meta.url)("sharp");
const dir = new URL("../../public/demo-gallery/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));

async function pixels(file) {
  const { data, info } = await sharp(new URL(file, dir).pathname)
    .resize(ANALYSIS_SIDE, ANALYSIS_SIDE, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { px: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
}
const ids = (m) => problemsFrom(m).map((p) => p.id);
const NORM = 0.45; // «нормальная» средняя яркость

test("хорошие фото: проблем нет, автоулучшение их не трогает", async () => {
  for (const it of manifest.items.filter((x) => x.problem === null)) {
    const { px, w, h } = await pixels(it.file);
    const m = analyzePixels(px, w, h);
    assert.deepEqual(ids(m), [], `${it.file}: ${ids(m)}`);
    assert.equal(autoParams(m), null, it.file);
  }
});

for (const file of ["cat-dark.jpg", "night-street.jpg"]) {
  test(`тёмное ${file}: «Темно», после автоулучшения ярче и ближе к норме`, async () => {
    const { px, w, h } = await pixels(file);
    const m = analyzePixels(px, w, h);
    assert.ok(ids(m).includes("dark"), ids(m).join());
    const auto = autoParams(m);
    assert.ok(auto && auto.exposure > 0, JSON.stringify(auto));
    const out = applyEdits(px, new Uint8ClampedArray(px.length), { auto });
    const m2 = analyzePixels(out, w, h);
    assert.ok(Math.abs(m2.mean - NORM) < Math.abs(m.mean - NORM), `${m.mean} → ${m2.mean}`);
    assert.ok(m2.p50 > m.p50, `медиана ${m.p50} → ${m2.p50}`);
    assert.ok(m2.clipLow <= m.clipLow, `провалы ${m.clipLow} → ${m2.clipLow}`);
    assert.ok(m2.clipHigh < 0.05, "не пересветили");
  });
}

test("пересвеченное braslav-lake-bright.jpg: «Пересвет», после автоулучшения ближе к норме", async () => {
  const { px, w, h } = await pixels("braslav-lake-bright.jpg");
  const m = analyzePixels(px, w, h);
  assert.ok(ids(m).includes("bright"), ids(m).join());
  const auto = autoParams(m);
  assert.ok(auto.exposure < 0 && auto.highlights < 0, JSON.stringify(auto));
  const out = applyEdits(px, new Uint8ClampedArray(px.length), { auto });
  const m2 = analyzePixels(out, w, h);
  assert.ok(Math.abs(m2.mean - NORM) < Math.abs(m.mean - NORM), `${m.mean} → ${m2.mean}`);
  assert.ok(m2.p50 < m.p50);
  assert.ok(m2.clipHigh <= m.clipHigh);
  assert.deepEqual(ids(m2), [], "после улучшения проблем нет: " + ids(m2));
});

test("жёлтый оттенок bison-yellow.jpg: «Оттенок», баланс белого уменьшает его", async () => {
  const { px, w, h } = await pixels("bison-yellow.jpg");
  const m = analyzePixels(px, w, h);
  assert.ok(ids(m).includes("cast"), ids(m).join());
  const auto = autoParams(m);
  assert.ok(auto.wb, JSON.stringify(auto));
  const m2 = analyzePixels(applyEdits(px, new Uint8ClampedArray(px.length), { auto }), w, h);
  assert.ok(m2.castStrength < m.castStrength, `${m.castStrength} → ${m2.castStrength}`);
});

test("размытое dog-blurry.jpg: «Размыто», а резкое dog.jpg — нет; автоулучшение резкость не обещает", async () => {
  const a = await pixels("dog-blurry.jpg");
  const b = await pixels("dog.jpg");
  const ma = analyzePixels(a.px, a.w, a.h);
  const mb = analyzePixels(b.px, b.w, b.h);
  assert.ok(ids(ma).includes("blurry"));
  assert.ok(!ids(mb).includes("blurry"));
  assert.ok(mb.sharpness > ma.sharpness * 10);
  assert.equal(autoParams(ma), null);
});

test("дубли (X-2): «Луговая герань — дубль» найден, разные снимки галереи — не дубли", async () => {
  const photos = [];
  for (const it of manifest.items.filter((x) => x.problem === null || x.problem === "duplicate")) {
    const { px, w, h } = await pixels(it.file);
    photos.push({ id: it.file, quality: { metrics: analyzePixels(px, w, h) } });
  }
  assert.deepEqual([...findDuplicates(photos)], ["flowers-2.jpg"]);
  const a = photos.find((p) => p.id === "flowers.jpg").quality.metrics.hash;
  assert.equal(hashDistance(a, a), 0);
});

test("мало точек для печати: значок по dpi", () => {
  const m = { mean: 0.5, p50: 0.5, p95: 0.8, contrast: 0.2, clipHigh: 0, clipLow: 0, castStrength: 0, highCastStrength: 0, sharpness: 500, noise: 2 };
  assert.ok(problemsFrom(m, { dpi: 90 }).some((p) => p.id === "dpi" && p.label === "Мало точек для печати" && p.level === "err"));
  assert.ok(!problemsFrom(m, { dpi: 300 }).some((p) => p.id === "dpi"));
});

test("правки неразрушающие: исходные пиксели не меняются, без правок — копия", () => {
  const src = new Uint8ClampedArray([10, 20, 30, 255, 200, 210, 220, 255]);
  const copy = src.slice();
  const out = applyParams(src, new Uint8ClampedArray(src.length), effectiveParams({ manual: { exposure: 40 } }));
  assert.deepEqual(src, copy);
  assert.ok(out[0] > src[0]);
  assert.deepEqual(applyEdits(src, new Uint8ClampedArray(src.length), {}), copy);
});

test("отмена автоулучшения; ручные шаги складываются в пределах ±100", () => {
  let e = { auto: { exposure: 50 }, manual: {} };
  assert.ok(hasAuto(e));
  assert.equal(effectiveParams({ ...e, autoOff: true }).exposure, 0);
  e = addManual(e, { exposure: 20 });
  e = addManual(e, { exposure: 90 });
  assert.equal(e.manual.exposure, 100);
  assert.equal(effectiveParams(e).exposure, 150, "«ярче» действует и поверх сильного автоулучшения");
  assert.ok(hasManual(e));
  assert.ok(!hasManual(addManual(e, { exposure: -100 })));
});
