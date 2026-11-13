// N7 (круг 0, требование жюри N3): на сервер из правок фото уходят только общие параметры — числа ползунков,
// автоулучшение, стиль, «Резкость ×2». Маски выделения (rle), ластик и «убери солнце» с координатами — только на устройстве.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compactEdits, normEdits, serverEdits, serverEditsMap } from "../../lib/photo/edits.js";
import { packEdits } from "../../lib/photo/maskStore.js";

// Правки фото «как на устройстве»: автоулучшение, ползунки, стиль, ×2, две правки по маске и «убери солнце»
const device = packEdits({
  v: 1,
  auto: { exposure: 31, shadows: 25, highlights: -10, saturation: 8, wb: [1.05, 1, 0.94] },
  autoOff: false,
  manual: { exposure: 20, warmth: 10, contrast: 0 },
  look: { sepia: 80, fade: 20 },
  upscale: 2,
  by: "command",
  ops: [
    { kind: "mask", act: "blur", id: "a1", mask: { w: 320, h: 213, rle: "QUJDREVGRw==" } },
    { kind: "mask", act: "lighten", id: "a2", mask: { w: 320, h: 213, rle: "SElKS0xNTg==" } },
    { kind: "heal", cx: 0.71, cy: 0.18, r: 0.06 },
  ],
});

// Все ключи объекта на любой глубине
const keysDeep = (o, out = new Set()) => {
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) (out.add(k), keysDeep(v, out));
  return out;
};

test("serverEdits: маски, rle, координаты и местные правки не уходят; общие параметры и число местных правок — уходят", () => {
  assert.ok(device.masks && device.ops.length === 3, "на устройстве маски и правки есть");
  const s = serverEdits(device);
  const keys = keysDeep(s);
  for (const k of ["ops", "masks", "rle", "mask", "m", "cx", "cy", "r", "w", "h", "id", "act", "kind"]) assert.ok(!keys.has(k), `ключа «${k}» нет`);
  assert.ok(!/rle|QUJD|SElK|0\.71|0\.18/.test(JSON.stringify(s)), JSON.stringify(s));
  assert.deepEqual(s.manual, { exposure: 20, warmth: 10 });
  assert.deepEqual(s.auto, { exposure: 31, highlights: -10, shadows: 25, saturation: 8, wb: [1.05, 1, 0.94] });
  assert.deepEqual(s.look, { sepia: 80, fade: 20 });
  assert.equal(s.upscale, 2);
  assert.equal(s.by, "command");
  assert.equal(s.local, 3, "только число местных правок");
  // Печатная версия на устройстве по-прежнему видит все правки
  assert.equal(compactEdits(device).ops.length, 3);
});

test("serverEdits: без правок — null; только местные правки — одно число; правки с другого устройства — их число сохраняется", () => {
  assert.equal(serverEdits(null), null);
  assert.equal(serverEdits(normEdits({})), null);
  const onlyLocal = serverEdits({ ops: [{ kind: "heal", cx: 0.5, cy: 0.1, r: 0.05 }] });
  assert.deepEqual(onlyLocal, { v: 1, auto: null, autoOff: false, manual: {}, local: 1 });
  // Устройство Б: местных правок здесь нет, с сервера пришло local: 2 — отправка их не стирает
  assert.equal(serverEdits({ manual: { exposure: 5 } }, 2).local, 2);
  assert.equal(serverEdits({}, 2).local, 2);
  assert.equal(serverEdits({ manual: { exposure: 5 } }, "x").local, undefined);
});

test("serverEditsMap: сервер чистит и старые записи (маски внутри правки, лишние поля)", () => {
  const old = { kind: "mask", act: "darken", id: "o1", mask: { w: 10, h: 10, rle: "AAAA" } };
  const map = serverEditsMap({
    p1: { v: 1, manual: { exposure: 10 }, ops: [old], masks: { k: { w: 1, h: 1, rle: "B" } }, secret: "x" },
    p2: { v: 1, auto: null, manual: {}, ops: [] },
    p3: { v: 1, manual: {}, local: 4 },
  });
  assert.deepEqual(Object.keys(map), ["p1", "p3"]);
  assert.deepEqual(map.p1, { v: 1, auto: null, autoOff: false, manual: { exposure: 10 }, local: 1 });
  assert.equal(map.p3.local, 4);
  assert.deepEqual(serverEditsMap(null), {});
  assert.deepEqual(serverEditsMap([1, 2]), {});
});
