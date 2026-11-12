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

// Критик S03 (круг 1): команды «наоборот» и разговорные формы — все фразы из отчёта
const CRITIC = [
  ["поменьше яркости", { exposure: -1 }],
  ["яркость поменьше", { exposure: -1 }],
  ["яркость пониже", { exposure: -1 }],
  ["контраст пониже", { contrast: -1 }],
  ["поменьше контраста", { contrast: -1 }],
  ["поменьше насыщенности", { saturation: -1 }],
  ["насыщенность пониже", { saturation: -1 }],
  ["чуть поменьше тепла", { warmth: -1 }],
  ["сделай менее ярким", { exposure: -1 }],
  ["менее ярко", { exposure: -1 }],
  ["сделай менее тёплым", { warmth: -1 }],
  ["не надо желтизны", { warmth: -1 }],
  ["слишком жёлтое", { warmth: -1 }],
  ["слишком синее", { warmth: 1 }],
  ["не надо так ярко", { exposure: -1 }],
  ["не надо темнее", { exposure: 1 }],
  ["слишком тепло", { warmth: -1 }],
  ["сделай ярче, пожалуйста", { exposure: 1 }],
  ["пожалуйста, сделай теплее", { warmth: 1 }],
  ["пересвечено", { highlights: -1 }],
  ["фото засвечено", { highlights: -1 }],
  ["темновато", { exposure: 1 }],
  ["приглуши свет", { exposure: -1 }],
  ["менее контрастно", { contrast: -1 }],
  ["слишком контрастно", { contrast: -1 }],
  ["яркость +30", { exposure: 1 }],
  ["яркость -20", { exposure: -1 }],
  ["желтовато", { warmth: -1 }],
  ["убери яркость", { exposure: -1 }],
  ["больше света", { exposure: 1 }],
];

for (const [phrase, want] of CRITIC) {
  test(`критик: «${phrase}»`, () => {
    const r = parseCommand(phrase);
    assert.equal(r.ok, true, `не разобрано: ${r.say}`);
    const adj = r.steps.find((x) => x.kind === "adjust");
    assert.ok(adj, `нет правки света и цвета: ${JSON.stringify(r.steps)}`);
    for (const [k, sign] of Object.entries(want)) {
      assert.equal(Math.sign(adj.deltas[k] || 0), sign, `${k}: ${JSON.stringify(adj.deltas)}`);
    }
    assert.doesNotMatch(r.say, /Не понял/);
  });
}

test("число в команде задаёт силу: «яркость +30» → +30, «контраст минус 10» → −10", () => {
  assert.equal(parseCommand("яркость +30").steps[0].deltas.exposure, 30);
  assert.equal(parseCommand("контраст минус 10").steps[0].deltas.contrast, -10);
});

test("ответ «ещё» без «ещё ещё»", () => {
  const a = parseCommand("сильнее", { last: parseCommand("ярче").steps[0] });
  const b = parseCommand("ещё", { last: a.steps[0] });
  assert.equal(b.say, "Сделали ещё ярче");
  assert.doesNotMatch(b.say, /ещё ещё/);
});

// S12 (критик S03, круг 2): отрицание после слова и жалобы не должны делать наоборот
const S12_CASES = [
  ["ярче не надо", { kind: "keep" }],
  ["теплее не надо", { kind: "keep" }],
  ["контраста не надо", { kind: "keep" }],
  ["темнее не надо", { kind: "keep" }],
  ["светлее не надо", { kind: "keep" }],
  ["ярче не нужно", { kind: "keep" }],
  ["перебор с яркостью", { exposure: -1 }],
  ["многовато тепла", { warmth: -1 }],
  ["очень жёлтое", { warmth: -1 }],
  ["очень тёмное", { exposure: 1 }],
  ["очень яркое", { exposure: -1 }],
  ["переборщили с контрастом", { contrast: -1 }],
  ["многовато синевы", { warmth: 1 }],
  ["желтизны не надо", { warmth: -1 }],
  ["сделай очень ярким", { exposure: 1 }],
  ["сделай небо закатным", { kind: "creative" }],
  ["закатное небо", { kind: "creative" }],
];
for (const [phrase, want] of S12_CASES) {
  test(`S12: «${phrase}»`, () => {
    const r = parseCommand(phrase);
    assert.equal(r.ok, true, `не разобрано: ${r.say}`);
    if (want.kind) {
      assert.ok(r.steps.some((x) => x.kind === want.kind), `нет шага ${want.kind}: ${JSON.stringify(r.steps)}`);
      if (want.kind === "keep") assert.match(r.say, /оставляю как есть/);
      return;
    }
    const adj = r.steps.find((x) => x.kind === "adjust");
    assert.ok(adj, `нет правки: ${JSON.stringify(r.steps)}`);
    for (const [k, sign] of Object.entries(want)) assert.equal(Math.sign(adj.deltas[k] || 0), sign, `${k}: ${JSON.stringify(adj.deltas)}`);
  });
}

test("D1: «Размыть фон» снова в подсказках — выделение касанием есть", async () => {
  const { SUGGESTIONS } = await import("../../lib/photo/commands.js");
  assert.ok(SUGGESTIONS.some((s) => /размыть фон/i.test(s)), SUGGESTIONS.join(", "));
});

test("D1: команды для выделенного касанием", async () => {
  const { parseCommand } = await import("../../lib/photo/commands.js");
  const cases = [
    ["осветли выделенное", { kind: "maskTone", dir: 1 }],
    ["сделай выделенное ярче", { kind: "maskTone", dir: 1 }],
    ["затемни предмет", { kind: "maskTone", dir: -1 }],
    ["выделенное темнее", { kind: "maskTone", dir: -1 }],
    ["убери выделенное", { kind: "remove", target: "selection" }],
    ["удали это", { kind: "remove", target: "selection" }],
    ["убери машину", { kind: "remove", target: "машину" }],
    ["убери человека слева", { kind: "remove", target: "человека слева" }],
    ["размой фон", { kind: "blurBackground" }],
    ["сделай боке", { kind: "blurBackground" }],
    // общие правки света не перехватываются
    ["осветли фото", { kind: "adjust" }],
    ["затемни тени", { kind: "adjust" }],
  ];
  for (const [text, want] of cases) {
    const r = parseCommand(text);
    assert.ok(r.ok, text);
    const s = r.steps[0];
    for (const [k, v] of Object.entries(want)) assert.equal(s[k], v, `${text}: ${JSON.stringify(s)}`);
  }
});
