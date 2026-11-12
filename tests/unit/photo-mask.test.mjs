// D1 / S03c: правки по маске (выделение касанием) — сжатие маски, «Осветлить», «Затемнить», «Размыть фон»,
// вырезка и дыра для ластика, совпадение превью и печати, «Резкость для печати» в расчёте dpi.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MASK_SIDE,
  applyMaskOpFull,
  blendUp,
  combineMasks,
  decodeMask,
  dilate,
  encodeMask,
  eraseCrop,
  eraseHole,
  makeMaskOp,
  maskArea,
  maskBox,
  resizeMask,
  splitOps,
  toMiganInputs,
} from "../../lib/photo/mask.js";
import { applyOps } from "../../lib/photo/local.js";
import { compactEdits, hasManual, normEdits } from "../../lib/photo/edits.js";
import { printDpi, slotDpi } from "../../lib/layout.js";

// Круг (cx, cy, r — доли кадра) как маска w×h
function circle(w, h, cx, cy, r) {
  const m = new Uint8Array(w * h);
  const side = Math.max(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x + 0.5 - cx * w) ** 2 + (y + 0.5 - cy * h) ** 2 <= (r * side) ** 2) m[y * w + x] = 1;
  return m;
}

// Кадр: плавный градиент + шахматка (чтобы размытие было заметно)
function frame(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const chk = (Math.floor(x / Math.max(2, w / 40)) + Math.floor(y / Math.max(2, h / 40))) % 2 ? 60 : 0;
      d[i] = 80 + (x / w) * 100 + chk;
      d[i + 1] = 90 + (y / h) * 80 + chk;
      d[i + 2] = 120 + chk;
      d[i + 3] = 255;
    }
  return d;
}

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

test("маска: сжатие RLE и обратно без потерь (случайные и круглые маски)", () => {
  for (let t = 0; t < 30; t++) {
    const w = 5 + ((t * 37) % 200);
    const h = 3 + ((t * 53) % 150);
    const m = new Uint8Array(w * h);
    let seed = t + 1;
    for (let i = 0; i < m.length; i++) {
      seed = (seed * 16807) % 2147483647;
      m[i] = seed % 7 === 0 ? 1 : 0;
    }
    const back = decodeMask(encodeMask(m, w, h));
    assert.deepEqual(Array.from(back), Array.from(m), `${w}×${h}`);
  }
  const c = circle(320, 240, 0.5, 0.5, 0.2);
  const enc = encodeMask(c, 320, 240);
  assert.deepEqual(Array.from(decodeMask(enc)), Array.from(c));
  // маленькая: ~2 серии на строку — лимит правок фото 20 КБ и настроек проекта 50 КБ не под угрозой
  assert.ok(enc.rle.length < 600, "длина " + enc.rle.length);
  // пустая и сплошная
  assert.equal(maskArea(decodeMask(encodeMask(new Uint8Array(100), 10, 10))), 0);
  assert.equal(maskArea(decodeMask(encodeMask(new Uint8Array(100).fill(1), 10, 10))), 100);
  // испорченная маска — null, а не исключение
  assert.equal(decodeMask({ w: 10, h: 10, rle: "%%%" }), null);
  assert.equal(decodeMask(null), null);
});

test("маска: уменьшение сохраняет площадь и рамку, правка хранит маску ≤ 320 точек", () => {
  const big = circle(1024, 768, 0.4, 0.45, 0.15);
  const small = resizeMask(big, 1024, 768, 320, 240);
  const ratio = maskArea(small) / (320 * 240) / (maskArea(big) / (1024 * 768));
  assert.ok(Math.abs(ratio - 1) < 0.05, "площадь " + ratio);
  const op = makeMaskOp("blurBg", big, 1024, 768);
  assert.equal(op.kind, "mask");
  assert.equal(op.act, "blurBg");
  assert.ok(Math.max(op.mask.w, op.mask.h) <= MASK_SIDE);
  assert.equal(op.mask.w / op.mask.h, 320 / 240);
  assert.ok(JSON.stringify(op).length < 1000, "размер правки " + JSON.stringify(op).length);
  const box = maskBox(decodeMask(op.mask), op.mask.w, op.mask.h);
  assert.ok(Math.abs(box.x + box.w / 2 - 0.4 * 320) < 3 && Math.abs(box.y + box.h / 2 - 0.45 * 240) < 3, JSON.stringify(box));
  assert.throws(() => makeMaskOp("paint", big, 1024, 768));
});

test("маска: «добавить» и «убрать» точкой — объединение и вычитание, расширение", () => {
  const a = circle(100, 100, 0.3, 0.5, 0.15);
  const b = circle(100, 100, 0.4, 0.5, 0.15);
  const u = combineMasks(a, b, "add");
  const s = combineMasks(a, b, "subtract");
  assert.ok(maskArea(u) > maskArea(a) && maskArea(u) > maskArea(b));
  assert.ok(maskArea(s) < maskArea(a));
  for (let i = 0; i < s.length; i++) assert.ok(!(s[i] && b[i]));
  const d = dilate(a, 100, 100, 3);
  assert.ok(maskArea(d) > maskArea(a));
  for (let i = 0; i < a.length; i++) if (a[i]) assert.equal(d[i], 1);
});

test("«Осветлить» и «Затемнить»: меняется только выделенное, вне маски — ни одного пикселя", () => {
  const w = 200;
  const h = 150;
  const bits = circle(w, h, 0.5, 0.5, 0.2);
  for (const act of ["lighten", "darken"]) {
    const op = makeMaskOp(act, bits, w, h);
    const src = frame(w, h);
    const out = applyMaskOpFull(src.slice(), w, h, op);
    const ci = (75 * w + 100) * 4; // центр — внутри
    if (act === "lighten") assert.ok(lum(out, ci) > lum(src, ci) + 10, act);
    else assert.ok(lum(out, ci) < lum(src, ci) - 10, act);
    // дальше 8 точек от края маски — без изменений
    const far = dilate(bits, w, h, 8);
    let changed = 0;
    for (let k = 0; k < w * h; k++) if (!far[k] && (out[k * 4] !== src[k * 4] || out[k * 4 + 1] !== src[k * 4 + 1] || out[k * 4 + 2] !== src[k * 4 + 2])) changed++;
    assert.equal(changed, 0, act + ": изменено вне маски " + changed);
  }
});

test("«Размыть фон»: фон размыт, главное (внутри маски) не тронуто", () => {
  const w = 240;
  const h = 180;
  const bits = circle(w, h, 0.5, 0.5, 0.22);
  const op = makeMaskOp("blurBg", bits, w, h);
  const src = frame(w, h);
  const out = applyMaskOpFull(src.slice(), w, h, op);
  // внутри (с запасом от края) — без изменений
  const inner = new Uint8Array(w * h);
  const shrink = circle(w, h, 0.5, 0.5, 0.18);
  let changedInside = 0;
  for (let k = 0; k < w * h; k++) {
    inner[k] = shrink[k];
    if (shrink[k] && Math.abs(out[k * 4] - src[k * 4]) > 1) changedInside++;
  }
  assert.equal(changedInside, 0, "внутри изменено " + changedInside);
  // фон: разница соседних пикселей (резкость шахматки) заметно меньше
  const grad = (d) => {
    let s = 0;
    let n = 0;
    for (let y = 2; y < h - 2; y++)
      for (let x = 2; x < 40; x++) {
        const i = (y * w + x) * 4;
        s += Math.abs(d[i] - d[i + 4]);
        n++;
      }
    return s / n;
  };
  assert.ok(grad(out) < grad(src) * 0.5, `резкость фона ${grad(src).toFixed(1)} → ${grad(out).toFixed(1)}`);
});

test("превью и печать совпадают: та же правка на кадре 300 и 1200 точек даёт ту же картинку в уменьшении", () => {
  const bits = circle(300, 200, 0.45, 0.5, 0.2);
  for (const act of ["lighten", "darken", "blurBg"]) {
    const op = makeMaskOp(act, bits, 300, 200);
    const small = applyMaskOpFull(frame(300, 200), 300, 200, op);
    const big = applyMaskOpFull(frame(1200, 800), 1200, 800, op);
    // уменьшаем большой в 4 раза и сравниваем среднюю разницу яркости
    let diff = 0;
    let n = 0;
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 300; x++) {
        let s = 0;
        for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) s += lum(big, ((y * 4 + dy) * 1200 + x * 4 + dx) * 4);
        diff += Math.abs(s / 16 - lum(small, (y * 300 + x) * 4));
        n++;
      }
    assert.ok(diff / n < 6, `${act}: средняя разница ${(diff / n).toFixed(2)}`);
  }
});

test("ластик: вырезка вокруг маски с полями, дыра закрывает предмет, вклейка только внутри", () => {
  const bits = circle(320, 240, 0.7, 0.4, 0.06);
  const op = makeMaskOp("erase", bits, 320, 240);
  for (const [W, H] of [
    [1280, 960],
    [4000, 3000],
  ]) {
    const crop = eraseCrop(op, W, H);
    assert.ok(crop.x >= 0 && crop.y >= 0 && crop.x + crop.w <= W && crop.y + crop.h <= H, JSON.stringify(crop));
    // предмет целиком внутри вырезки, с полями
    const sx = W / 320;
    const box = maskBox(decodeMask(op.mask), 320, 240);
    assert.ok(crop.x < box.x * sx && crop.x + crop.w > (box.x + box.w) * sx);
    assert.ok(Math.max(crop.iw, crop.ih) <= 1024, "размер для нейросети " + crop.iw + "×" + crop.ih);
    const { hole, alpha } = eraseHole(op, crop, W, H);
    assert.equal(hole.length, crop.iw * crop.ih);
    // центр предмета — в дыре и заменяется полностью; угол вырезки — не трогаем
    const cx = Math.round(((0.7 * W - crop.x) / crop.w) * crop.iw);
    const cy = Math.round(((0.4 * H - crop.y) / crop.h) * crop.ih);
    assert.equal(hole[cy * crop.iw + cx], 1);
    assert.equal(alpha[cy * crop.iw + cx], 1);
    assert.equal(hole[0], 0);
    assert.ok(alpha[0] < 0.01);
    // дыра шире предмета (край и тень уходят)
    let holeN = 0;
    for (const v of hole) holeN += v;
    assert.ok(holeN > 0 && holeN < crop.iw * crop.ih * 0.6, "площадь дыры " + holeN);
    const { chw, keep } = toMiganInputs(new Uint8ClampedArray(crop.iw * crop.ih * 4).fill(7), hole, crop.iw, crop.ih);
    assert.equal(chw.length, 3 * crop.iw * crop.ih);
    assert.equal(keep[cy * crop.iw + cx], 0);
    assert.equal(keep[0], 255);
  }
  // вклейка: прозрачность 0 — пиксель не меняется, 1 — берётся результат
  const orig = new Uint8ClampedArray([10, 10, 10, 255, 10, 10, 10, 255]);
  const up = new Uint8ClampedArray([200, 200, 200, 255, 200, 200, 200, 255]);
  blendUp(orig, up, new Float32Array([0, 1]), 2, 1, 2, 1);
  assert.deepEqual(Array.from(orig), [10, 10, 10, 255, 200, 200, 200, 255]);
  assert.equal(eraseCrop({ kind: "mask", act: "erase", mask: encodeMask(new Uint8Array(4), 2, 2) }, 100, 100), null);
});

test("порядок правок: ластик отдельно (до света и цвета), остальные — по порядку в applyOps", () => {
  const bits = circle(100, 100, 0.5, 0.5, 0.2);
  const ops = [makeMaskOp("erase", bits, 100, 100), { kind: "heal", cx: 0.2, cy: 0.2, r: 0.05 }, makeMaskOp("lighten", bits, 100, 100)];
  const { erase, rest } = splitOps(ops);
  assert.equal(erase.length, 1);
  assert.deepEqual(
    rest.map((o) => o.kind + (o.act || "")),
    ["heal", "masklighten"],
  );
  // applyOps пропускает ластик (его делает нейросеть) и применяет осветление
  const src = frame(100, 100);
  const out = applyOps(src.slice(), 100, 100, [erase[0]]);
  assert.deepEqual(Array.from(out), Array.from(src));
  const lit = applyOps(src.slice(), 100, 100, [rest[1]]);
  assert.ok(lum(lit, (50 * 100 + 50) * 4) > lum(src, (50 * 100 + 50) * 4));
});

test("«Резкость для печати»: правка сохраняется, считается правкой, dpi ×2", () => {
  const e = normEdits({ upscale: 2, ops: [] });
  assert.equal(e.upscale, 2);
  assert.equal(normEdits({ upscale: 5 }).upscale, undefined);
  assert.ok(hasManual(e));
  assert.equal(compactEdits(e).upscale, 2);
  assert.equal(compactEdits(normEdits({})), null);
  const photo = { w: 1000, h: 750 };
  const size = { w: 20, h: 15 };
  assert.ok(Math.abs(printDpi({ ...photo, edits: { upscale: 2 } }, size) - printDpi(photo, size) * 2) <= 1);
  const slot = { w: 0.5, h: 0.5 };
  assert.ok(Math.abs(slotDpi({ ...photo, edits: { upscale: 2 } }, slot, 20, 20) - slotDpi(photo, slot, 20, 20) * 2) <= 1);
});

test("воркеры Turbopack: параметры из #params= переносятся в ?params= (обход старых Chrome)", async () => {
  const { fixUrl } = await import("../../lib/workerShim.js");
  const params = JSON.stringify([["/_next/static/chunks/a.js", "/_next/static/chunks/b.js"], "", "/_next/", null, null]);
  const u = "http://x.test/_next/static/chunks/turbopack-worker-1.js#params=" + encodeURIComponent(params);
  const out = new URL(fixUrl(u));
  assert.equal(out.hash, "");
  assert.equal(out.searchParams.get("params"), params);
  // другие адреса не трогаем
  assert.equal(fixUrl("http://x.test/a.js#params=1"), "http://x.test/a.js#params=1");
  assert.equal(fixUrl("/ort/x.mjs"), "/ort/x.mjs");
});

// ---------- D1 fix1 (критик): маски хранятся один раз и всегда помещаются в предел правок фото ----------

// «Листва»: много мелких пятен (сложная маска, как у критика на «Осеннем лесе»)
function blobs(w, h, n, seed) {
  const m = new Uint8Array(w * h);
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w;
    const cy = rnd() * h;
    const r = 2 + rnd() * 8;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, cy + r + 1); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, cx + r + 1); x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
  }
  return m;
}

test("fix1: 8 правок «Затемнить/Осветлить» по одному выделению — маска хранится один раз, правки фото маленькие", async () => {
  const { addMaskOp, MAX_MASK_OPS } = await import("../../lib/photo/mask.js");
  const { editsBytes, compactEdits, normEdits, PHOTO_EDITS_MAX } = await import("../../lib/photo/edits.js");
  const sel = blobs(1024, 768, 1000, 3); // очень сложное выделение
  let ed = normEdits({});
  for (let i = 0; i < MAX_MASK_OPS; i++) ed = addMaskOp(ed, i % 2 ? "lighten" : "darken", sel, 1024, 768).edits;
  assert.equal(ed.ops.length, 8);
  assert.equal(Object.keys(ed.masks).length, 1, "одна маска на 8 правок");
  assert.ok(ed.ops.every((o) => o.m && !o.mask));
  const bytes = editsBytes(compactEdits(ed));
  assert.ok(bytes < 4000, "правки фото " + bytes + " Б");
  assert.ok(bytes < PHOTO_EDITS_MAX);
});

test("fix1: 8 разных сложных выделений — каждая маска ужата до ≤ 1800 символов, все вместе помещаются в предел", async () => {
  const { addMaskOp, encodeMaskAdaptive, MASK_RLE_MAX, editsFit } = await import("../../lib/photo/mask.js");
  const { editsBytes, compactEdits, normEdits, PHOTO_EDITS_MAX } = await import("../../lib/photo/edits.js");
  let ed = normEdits({});
  for (let i = 0; i < 8; i++) {
    const b = blobs(1024, 768, 400, 100 + i);
    const enc = encodeMaskAdaptive(b, 1024, 768);
    assert.ok(enc.rle.length <= MASK_RLE_MAX, `маска ${i}: ${enc.w}×${enc.h}, ${enc.rle.length}`);
    ed = addMaskOp(ed, "darken", b, 1024, 768).edits;
  }
  assert.equal(Object.keys(ed.masks).length, 8);
  const bytes = editsBytes(compactEdits(ed));
  assert.ok(bytes < PHOTO_EDITS_MAX, "правки фото " + bytes + " Б");
  assert.ok(editsFit(compactEdits(ed)));
  // простое выделение (собака) остаётся в полном размере маски 320
  const simple = encodeMaskAdaptive(circle(1024, 768, 0.5, 0.5, 0.2), 1024, 768);
  assert.equal(Math.max(simple.w, simple.h), 320);
});

test("fix1: предел правок фото — тот же счёт у редактора и сервера; слишком большие правки не проходят editsFit", async () => {
  const { editsFit, PHOTO_EDITS_SAFE } = await import("../../lib/photo/mask.js");
  const { editsBytes, PHOTO_EDITS_MAX } = await import("../../lib/photo/edits.js");
  assert.equal(PHOTO_EDITS_MAX, 20_000);
  assert.ok(PHOTO_EDITS_SAFE < PHOTO_EDITS_MAX);
  const big = { v: 1, ops: [], masks: { a: { w: 10, h: 10, rle: "x".repeat(PHOTO_EDITS_MAX) } } };
  assert.ok(editsBytes(big) > PHOTO_EDITS_MAX);
  assert.equal(editsFit(big), false);
  assert.equal(editsFit({ v: 1, ops: [] }), true);
  assert.equal(editsBytes(null), 2);
});

test("fix1: старые черновики (маска в каждой правке) читаются и сжимаются без потерь; лишние маски убираются", async () => {
  const { makeMaskOp, packEdits, hydrateOps, opMask } = await import("../../lib/photo/mask.js");
  const { normEdits } = await import("../../lib/photo/edits.js");
  const { applyOps } = await import("../../lib/photo/local.js");
  const bits = circle(200, 150, 0.5, 0.5, 0.2);
  const a = makeMaskOp("lighten", bits, 200, 150);
  const b = makeMaskOp("darken", bits, 200, 150);
  const c = makeMaskOp("blurBg", circle(200, 150, 0.3, 0.3, 0.1), 200, 150);
  const old = normEdits({ ops: [a, { kind: "heal", cx: 0.1, cy: 0.1, r: 0.05 }, b, c] });
  const packed = normEdits(packEdits(old));
  assert.equal(Object.keys(packed.masks).length, 2, "две разные маски");
  assert.equal(packed.ops[0].m, packed.ops[2].m, "одинаковая маска — один ключ");
  assert.equal(packed.ops[1].kind, "heal");
  assert.ok(JSON.stringify(packed).length < JSON.stringify(old).length);
  // те же пиксели, что и со старым видом
  const src = frame(200, 150);
  const viaOld = applyOps(src.slice(), 200, 150, hydrateOps(old));
  const viaNew = applyOps(src.slice(), 200, 150, hydrateOps(packed));
  assert.deepEqual(Array.from(viaNew), Array.from(viaOld));
  assert.deepEqual(opMask(packed.ops[3], packed), c.mask);
  // убрали правку — её маска, если на неё больше никто не ссылается, удаляется
  const fewer = packEdits({ ...packed, ops: packed.ops.slice(0, 3) });
  assert.equal(Object.keys(fewer.masks).length, 1);
  // правка без маски (испорчена) пропускается, а не роняет превью
  assert.equal(hydrateOps({ ops: [{ kind: "mask", act: "lighten", id: "x", m: "nope" }] }).length, 0);
  // normEdits отбрасывает неверные записи масок
  const n = normEdits({ masks: { ok: { w: 2, h: 2, rle: "AQ==" }, "bad key!": { w: 1, h: 1, rle: "" }, z: { w: "2", h: 2, rle: "" } } });
  assert.deepEqual(Object.keys(n.masks), ["ok"]);
});

test("fix1: размеры файлов моделей в modelFiles.js совпадают с public/ (честный процент загрузки)", async () => {
  const { statSync } = await import("node:fs");
  const { SAM_FILES, ORT_WASM, MIGAN_FILE } = await import("../../lib/photo/modelFiles.js");
  for (const f of [...SAM_FILES, ORT_WASM, MIGAN_FILE]) {
    const size = statSync(new URL("../../public" + f.url, import.meta.url)).size;
    assert.equal(f.size, size, f.url);
  }
});

test("fix1: процент загрузки по байтам растёт без скачков и без Content-Length (сжатые ответы Vercel)", async () => {
  const { fetchAll } = await import("../../lib/photo/fetchBytes.js");
  const real = globalThis.fetch;
  const files = [
    { url: "/a.onnx", size: 3000 },
    { url: "/b.wasm", size: 5000 },
  ];
  globalThis.fetch = async (url) => {
    const size = files.find((f) => f.url === url).size;
    let sent = 0;
    const stream = new ReadableStream({
      pull(ctrl) {
        if (sent >= size) return ctrl.close();
        const n = Math.min(700, size - sent);
        ctrl.enqueue(new Uint8Array(n).fill(sent % 251));
        sent += n;
      },
    });
    return new Response(stream); // без Content-Length
  };
  try {
    const seen = [];
    const out = await fetchAll(files, (p) => seen.push(p));
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `скачок назад: ${seen[i - 1]} → ${seen[i]}`);
    assert.equal(seen[0], 0);
    assert.equal(seen[seen.length - 1], 1);
    assert.ok(seen.length > 5, "процент обновляется по ходу");
    assert.equal(out.get("/a.onnx").length, 3000);
    assert.equal(out.get("/b.wasm").length, 5000);
  } finally {
    globalThis.fetch = real;
  }
});

test("fix1: «Проверка» для фото с «Резкостью ×2» — размер и точки на дюйм про одно и то же", async () => {
  const { runChecks } = await import("../../lib/checks.js");
  const product = { kind: "photo", sizes: [{ id: "10x15", w: 10, h: 15 }] };
  const photo = { id: "p1", name: "nesvizh-small.jpg", supported: true, w: 400, h: 274 };
  const plain = runChecks({ photos: [photo], sizeId: "10x15" }, product).issues.find((i) => i.key === "dpi:p1");
  const up = runChecks({ photos: [{ ...photo, edits: { upscale: 2 } }], sizeId: "10x15" }, product).issues.find((i) => i.key === "dpi:p1");
  assert.match(plain.text, /400×274 точек — это \d+ точек на дюйм/);
  assert.match(up.text, /800×548 точек \(с «Резкостью для печати ×2»\) — это \d+ точек на дюйм/);
  const dpi = (t) => Number(t.match(/это (\d+) точек на дюйм/)[1]);
  assert.ok(Math.abs(dpi(up.text) - dpi(plain.text) * 2) <= 1);
});
