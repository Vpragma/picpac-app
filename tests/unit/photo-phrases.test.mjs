// N3: свободные фразы — локально. Набор из 100+ фраз (синонимы, разговорные формы, опечатки, падежи, стили-пресеты,
// предметы словом) → ожидаемая правка. Считаем и печатаем точность словаря на устройстве; порог — 90 %.
// Ожидание: { adjust: { ключ: знак } } — правка света и цвета; { preset: "id" } — стиль; { look: null } — убрать стиль;
// { kind, cls?, dir?, where? } — остальное (cls — класс детектора YOLOX, lib/photo/yolox.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "../../lib/photo/commands.js";
import { COCO } from "../../lib/photo/yolox.js";

export const PHRASES = [
  // Свет и цвет: синонимы и разговорные формы
  ["сделай посветлее", { adjust: { exposure: 1 } }],
  ["чуть-чуть светлее", { adjust: { exposure: 1 } }],
  ["фото тёмное", { adjust: { exposure: 1 } }],
  ["тёмная фотка", { adjust: { exposure: 1 } }],
  ["мрачновато", { adjust: { exposure: 1 } }],
  ["добавь света", { adjust: { exposure: 1 } }],
  ["убавь свет", { adjust: { exposure: -1 } }],
  ["яркость на максимум", { adjust: { exposure: 1 } }],
  ["сбавь яркость", { adjust: { exposure: -1 } }],
  ["темнее на 30", { adjust: { exposure: -1 } }],
  ["сделай поконтрастнее", { adjust: { contrast: 1 } }],
  ["понасыщеннее", { adjust: { saturation: 1 } }],
  ["холоднее чуток", { adjust: { warmth: -1 } }],
  ["слишком холодное", { adjust: { warmth: 1 } }],
  ["снимок слишком холодный", { adjust: { warmth: 1 } }],
  ["убери красноту", { adjust: { warmth: -1 } }],
  ["убери синеву", { adjust: { warmth: 1 } }],
  ["цвета поярче", { adjust: { saturation: 1 } }],
  ["поменьше насыщенности", { adjust: { saturation: -1 } }],
  ["осветли тени", { adjust: { shadows: 1 } }],
  ["пересвечено", { adjust: { highlights: -1 } }],
  ["затемни небо", { adjust: { exposure: -1 } }],
  ["теплее и ярче", { adjust: { warmth: 1, exposure: 1 } }],
  ["мягче", { adjust: { contrast: -1 } }],
  ["контрастнее", { adjust: { contrast: 1 } }],
  ["холоднее", { adjust: { warmth: -1 } }],
  // Управление
  ["исправь цвета", { kind: "auto" }],
  ["баланс белого", { kind: "auto" }],
  ["сделай естественнее", { kind: "auto" }],
  ["автоулучшение", { kind: "auto" }],
  ["верни как было", { kind: "reset" }],
  ["сбрось всё", { kind: "reset" }],
  ["отмени последнее", { kind: "undo" }],
  ["назад", { kind: "undo" }],
  // Стили-пресеты
  ["как в старом кино", { preset: "oldfilm" }],
  ["сделай как в старом фильме", { preset: "oldfilm" }],
  ["немое кино", { preset: "oldfilm" }],
  ["ч/б", { preset: "bw" }],
  ["чб", { preset: "bw" }],
  ["сделай черно белым", { preset: "bw" }],
  ["монохром", { preset: "bw" }],
  ["без цвета", { preset: "bw" }],
  ["сепия", { preset: "sepia" }],
  ["в сепии", { preset: "sepia" }],
  ["коричневый оттенок", { preset: "sepia" }],
  ["винтаж", { preset: "vintage" }],
  ["винтажненько", { preset: "vintage" }],
  ["как на плёнку", { preset: "vintage" }],
  ["ретро", { preset: "vintage" }],
  ["полароид", { preset: "vintage" }],
  ["тёплый вечер", { preset: "evening" }],
  ["вечернее настроение", { preset: "evening" }],
  ["золотой час", { preset: "evening" }],
  ["осеннее настроение", { preset: "autumn" }],
  ["по-осеннему", { preset: "autumn" }],
  ["осень", { preset: "autumn" }],
  ["зимнее", { preset: "winter" }],
  ["по-зимнему", { preset: "winter" }],
  ["ярко как летом", { preset: "summer" }],
  ["летнее настроение", { preset: "summer" }],
  ["солнечно", { preset: "summer" }],
  ["весеннее", { preset: "spring" }],
  ["пастельные тона", { preset: "soft" }],
  ["нежно", { preset: "soft" }],
  ["драматично", { preset: "drama" }],
  ["нуар", { preset: "noir" }],
  ["как в кино", { preset: "cinema" }],
  ["кинематографично", { preset: "cinema" }],
  ["как старое фото", { preset: "oldphoto" }],
  ["состарь фото", { preset: "oldphoto" }],
  ["сделай как в инстаграме", { preset: "vivid" }],
  ["верни цвет", { look: null }],
  ["убери фильтр", { look: null }],
  ["без эффектов", { look: null }],
  // Опечатки
  ["ярчи", { adjust: { exposure: 1 } }],
  ["сделай тепле", { adjust: { warmth: 1 } }],
  ["теплей", { adjust: { warmth: 1 } }],
  ["контраз побольше", { adjust: { contrast: 1 } }],
  ["свелее", { adjust: { exposure: 1 } }],
  ["темнеее", { adjust: { exposure: -1 } }],
  ["насыщенее", { adjust: { saturation: 1 } }],
  ["сепею", { preset: "sepia" }],
  ["винтарж", { preset: "vintage" }],
  ["чорно-белое", { preset: "bw" }],
  ["размой сабаку", { kind: "maskBlur", cls: "dog" }],
  ["убери машыну", { kind: "remove", cls: "car" }],
  ["убери чилавека", { kind: "remove", cls: "person" }],
  // Предметы словом (падежи, число, где)
  ["убери машину", { kind: "remove", cls: "car" }],
  ["удали человека", { kind: "remove", cls: "person" }],
  ["убери людей", { kind: "remove", cls: "person" }],
  ["сотри велосипед", { kind: "remove", cls: "bicycle" }],
  ["убери птицу", { kind: "remove", cls: "bird" }],
  ["убери мяч", { kind: "remove", cls: "sports ball" }],
  ["убери бутылку", { kind: "remove", cls: "bottle" }],
  ["убери зонт", { kind: "remove", cls: "umbrella" }],
  ["убери сумку", { kind: "remove", cls: "handbag" }],
  ["убери стул", { kind: "remove", cls: "chair" }],
  ["убери лошадь", { kind: "remove", cls: "horse" }],
  ["убери мотоцикл", { kind: "remove", cls: "motorcycle" }],
  ["убери автобус", { kind: "remove", cls: "bus" }],
  ["убери человека справа", { kind: "remove", cls: "person", where: "right" }],
  ["убери машину слева", { kind: "remove", cls: "car", where: "left" }],
  ["размой собаку", { kind: "maskBlur", cls: "dog" }],
  ["размой кошку", { kind: "maskBlur", cls: "cat" }],
  ["размой лицо человека", { kind: "maskBlur", cls: "person" }],
  ["заблюрь машину", { kind: "maskBlur", cls: "car" }],
  ["осветли человека", { kind: "maskTone", cls: "person", dir: 1 }],
  ["осветли собаку", { kind: "maskTone", cls: "dog", dir: 1 }],
  ["затемни машину", { kind: "maskTone", cls: "car", dir: -1 }],
  ["собаку посветлее", { kind: "maskTone", cls: "dog", dir: 1 }],
  ["машину темнее", { kind: "maskTone", cls: "car", dir: -1 }],
  ["размой фон вокруг собаки", { kind: "blurBackground", cls: "dog" }],
  ["размой всё кроме человека", { kind: "blurBackground", cls: "person" }],
  ["найди кошку", { kind: "find", cls: "cat" }],
  ["выдели собаку", { kind: "find", cls: "dog" }],
  // Не предметы: старые правила не перехвачены
  ["убери солнце", { kind: "remove", target: "sun" }],
  ["размой фон", { kind: "blurBackground" }],
  ["убери пересвет", { adjust: { highlights: -1 } }],
];

// Совпадает ли ответ словаря с ожиданием. r — parseCommand(); → "" или причина
export function mismatch(r, want) {
  if (!r?.ok) return "не понял";
  const adj = r.steps.find((s) => s.kind === "adjust");
  if (want.adjust) {
    if (!adj) return "нет правки света и цвета: " + JSON.stringify(r.steps);
    for (const [k, sign] of Object.entries(want.adjust)) if (Math.sign(adj.deltas[k] || 0) !== sign) return `${k}: ${adj.deltas[k]}`;
    return "";
  }
  if (want.preset) return adj && String(adj.preset || "").split("+").includes(want.preset) ? "" : "стиль: " + (adj?.preset || "нет");
  if ("look" in want) return r.steps.some((s) => s.kind === "look" && s.look === null) ? "" : "нет «убрать стиль»";
  const s = r.steps.find((x) => x.kind === want.kind);
  if (!s) return `нет шага ${want.kind}: ${JSON.stringify(r.steps.map((x) => x.kind))}`;
  if (want.cls && !(s.classes || []).includes(COCO.indexOf(want.cls))) return "классы: " + JSON.stringify(s.classes);
  if (want.dir && s.dir !== want.dir) return "dir: " + s.dir;
  if (want.where && s.where !== want.where) return "где: " + s.where;
  if (want.target && s.target !== want.target) return "цель: " + s.target;
  return "";
}

test(`N3: точность словаря на ${PHRASES.length} фразах — не ниже 90 %`, () => {
  assert.ok(PHRASES.length >= 80, "в наборе не меньше 80 фраз");
  const bad = [];
  for (const [phrase, want] of PHRASES) {
    const why = mismatch(parseCommand(phrase), want);
    if (why) bad.push(`«${phrase}» — ${why}`);
  }
  const ok = PHRASES.length - bad.length;
  const pct = Math.round((ok / PHRASES.length) * 1000) / 10;
  console.log(`Точность словаря на устройстве: ${ok}/${PHRASES.length} = ${pct}%`);
  if (bad.length) console.log("Не совпало:\n  " + bad.join("\n  "));
  assert.ok(pct >= 90, `точность ${pct}% < 90%`);
});

test("N3: непонятное — подсказка с примерами стилей и предметов", () => {
  const r = parseCommand("сделай как у Ван Гога");
  assert.equal(r.ok, false);
  assert.match(r.say, /Не понял/);
  assert.match(r.say, /старом кино/);
  assert.match(r.say, /убери машину/);
});

test("N3: стиль-пресет — ползунки и стиль; несколько стилей складываются", () => {
  const bw = parseCommand("ч/б").steps[0];
  assert.deepEqual(bw.look, { mono: 100 });
  const mix = parseCommand("сепия и винтаж").steps[0];
  assert.equal(mix.look.sepia, 85);
  assert.equal(mix.look.fade, 40);
  assert.ok(parseCommand("чуть-чуть винтажа").steps[0].deltas.saturation > parseCommand("винтаж").steps[0].deltas.saturation);
});
