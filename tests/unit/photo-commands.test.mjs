// Разбор команд редактора словарём (S03b): минимум 40 фраз
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../../lib/photo/commands.js";

// [фраза, ожидание]: { key: знак (+1/−1) } для света и цвета, или { kind } для остальных
const CASES = [
  ["сделай ярче", { exposure: 1 }],
  ["Ярче", { exposure: 1 }],
  ["поярче", { exposure: 1 }],
  ["светлее", { exposure: 1 }],
  ["осветли фото", { exposure: 1 }],
  ["сделай темнее", { exposure: -1 }],
  ["затемни", { exposure: -1 }],
  ["слишком ярко", { exposure: -1 }],
  ["не так ярко", { exposure: -1 }],
  ["не такое тёмное", { exposure: 1 }],
  ["добавь яркости", { exposure: 1 }],
  ["убавь яркость", { exposure: -1 }],
  ["больше контраста", { contrast: 1 }],
  ["контрастнее", { contrast: 1 }],
  ["меньше контраста", { contrast: -1 }],
  ["сделай мягче", { contrast: -1 }],
  ["теплее", { warmth: 1 }],
  ["чуть теплее", { warmth: 1 }],
  ["Теплее", { warmth: 1 }],
  ["похолоднее", { warmth: -1 }],
  ["сделай холоднее", { warmth: -1 }],
  ["убери желтизну", { warmth: -1 }],
  ["убери синеву", { warmth: 1 }],
  ["насыщеннее", { saturation: 1 }],
  ["цвета ярче", { saturation: 1 }],
  ["сделай цвета бледнее", { saturation: -1 }],
  ["сочнее", { contrast: 1 }],
  ["чёрно-белое", { saturation: -1 }],
  ["убери пересвет", { highlights: -1 }],
  ["Убрать пересвет", { highlights: -1 }],
  ["исправь пересвет", { highlights: -1 }],
  ["приглуши светлые", { highlights: -1 }],
  ["осветли тени", { shadows: 1 }],
  ["тени темнее", { shadows: -1 }],
  ["ярче и теплее", { exposure: 1, warmth: 1 }],
  ["намного ярче, холоднее", { exposure: 1, warmth: -1 }],
  ["пожалуйста сделай фото чуть светлее", { exposure: 1 }],
  ["Размыть фон", { kind: "blurBackground" }],
  ["размой фон", { kind: "blurBackground" }],
  ["Убрать солнце", { kind: "remove", target: "sun" }],
  ["убери солнце", { kind: "remove", target: "sun" }],
  ["убери человека справа", { kind: "remove" }],
  ["улучши фото", { kind: "auto" }],
  ["сделай лучше", { kind: "auto" }],
  ["верни оригинал", { kind: "reset" }],
  ["вернуть как было", { kind: "reset" }],
  ["отмени", { kind: "undo" }],
  ["замени небо на закат", { kind: "creative" }],
];

for (const [phrase, want] of CASES) {
  test(`команда «${phrase}»`, () => {
    const r = parseCommand(phrase);
    assert.equal(r.ok, true, `не разобрано: ${r.say}`);
    assert.ok(r.say && r.say.length > 2, "есть ответ словами");
    if (want.kind) {
      const s = r.steps.find((x) => x.kind === want.kind);
      assert.ok(s, `нет шага ${want.kind}: ${JSON.stringify(r.steps)}`);
      if (want.target) assert.equal(s.target, want.target);
      return;
    }
    const adj = r.steps.find((x) => x.kind === "adjust");
    assert.ok(adj, `нет правки света и цвета: ${JSON.stringify(r.steps)}`);
    for (const [k, sign] of Object.entries(want)) {
      assert.ok(adj.deltas[k], `нет ${k}: ${JSON.stringify(adj.deltas)}`);
      assert.equal(Math.sign(adj.deltas[k]), sign, `${k}: ${adj.deltas[k]}`);
    }
  });
}

test("усилители: «чуть» слабее, «намного» сильнее обычного шага", () => {
  const base = parseCommand("ярче").steps[0].deltas.exposure;
  const soft = parseCommand("чуть ярче").steps[0].deltas.exposure;
  const strong = parseCommand("намного ярче").steps[0].deltas.exposure;
  assert.ok(soft > 0 && soft < base, `${soft} < ${base}`);
  assert.ok(strong > base, `${strong} > ${base}`);
  assert.ok(parseCommand("сильнее теплее").steps[0].deltas.warmth > parseCommand("теплее").steps[0].deltas.warmth);
});

test("«ещё» и «сильнее» без цели повторяют последний шаг", () => {
  const first = parseCommand("теплее");
  const again = parseCommand("ещё", { last: first.steps[0] });
  assert.equal(again.ok, true);
  assert.ok(again.steps[0].deltas.warmth > 0);
});

test("непонятная команда — подсказка, не молчание", () => {
  for (const phrase of ["абракадабра", "сделай как у Ван Гога", "", "   "]) {
    const r = parseCommand(phrase);
    assert.equal(r.ok, false, phrase);
    assert.match(r.say, /Не понял|Напишите/);
    assert.ok(r.suggestions.length >= 3);
  }
});

test("в наборе не меньше 40 фраз", () => assert.ok(CASES.length >= 40));
