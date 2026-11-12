// N3 (SHOULD): фразы вне словаря — маленькая модель на устройстве (rubert-tiny, MIT, int8 12 МБ) подбирает ближайшую
// команду или стиль по смыслу. Набор из 30 перефразировок, которых словарь не знает: считаем точность словаря,
// словаря + модели (сразу выполнили верное) и «верное среди 3 предложенных кнопок». Числа печатаются для отчёта.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCommand } from "../../lib/photo/commands.js";
import { decide, embedText, loadTable, rankIntents } from "../../lib/photo/meaning.js";
import { INTENTS } from "../../lib/photo/intents.js";
import { PHRASES, mismatch } from "./photo-phrases.test.mjs";
import { loadMeaningNode } from "../helpers/meaning-node.mjs";

// [фраза, допустимые смыслы]
const OUTSIDE = [
  ["добавь солнца", ["summer", "warmer", "brighter"]],
  ["как будто снято в девяностые", ["vintage"]],
  ["атмосфера ноября", ["autumn"]],
  ["как фото бабушки", ["oldphoto", "sepia", "vintage", "bw"]],
  ["чтобы было как на морозе", ["winter", "colder"]],
  ["сделай повеселее", ["saturate", "brighter", "summer"]],
  ["пусть будет как на пляже", ["summer"]],
  ["слишком серо", ["saturate", "contrast"]],
  ["как в фильме ужасов", ["drama"]],
  ["пусть светится", ["brighter"]],
  ["как в портретном режиме", ["blurbg"]],
  ["небо слишком белое", ["highlights"]],
  ["как в январе", ["winter"]],
  ["как на морском курорте", ["summer"]],
  ["сделай нормально", ["auto"]],
  ["поправь как надо", ["auto"]],
  ["всё слишком пёстрое", ["desaturate"]],
  ["убери серость", ["saturate", "contrast", "auto"]],
  ["майское настроение", ["spring"]],
  ["цветущий сад", ["spring"]],
  ["жаркий июль", ["summer"]],
  ["как газетная фотография", ["bw", "oldphoto"]],
  ["фото как из семейного архива", ["oldphoto", "sepia", "vintage"]],
  ["киноплёнка восьмидесятых", ["vintage", "oldfilm"]],
  ["не видно деталей в темноте", ["brighter", "shadows"]],
  ["сделай как на рассвете", ["evening", "soft", "warmer"]],
  ["чтобы цвета не кричали", ["desaturate", "softer"]],
  ["как в ноябре", ["autumn"]],
  ["тепло как дома у камина", ["warmer", "evening"]],
  ["холодный скандинавский стиль", ["colder", "winter"]],
];

// Что сделал словарь — в тех же смыслах (для честного сравнения)
const PRESET_INTENT = { noir: "bw", cinema: "contrast", vivid: "saturate" };
function dictIntent(r) {
  if (!r.ok) return null;
  const s = r.steps[0];
  if (s.kind === "auto") return "auto";
  if (s.kind === "reset") return "reset";
  if (s.kind === "blurBackground") return "blurbg";
  if (s.kind !== "adjust") return s.kind;
  if (s.preset) return PRESET_INTENT[s.preset] || s.preset.split("+")[0];
  const [k, v] = Object.entries(s.deltas).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0] || [];
  const map = { exposure: ["brighter", "darker"], warmth: ["warmer", "colder"], contrast: ["contrast", "softer"], saturation: ["saturate", "desaturate"], highlights: ["highlights", "highlights"], shadows: ["shadows", "shadows"] };
  return map[k]?.[v > 0 ? 0 : 1] || null;
}

let rt;
let table;
test.before(async () => {
  rt = await loadMeaningNode();
  table = loadTable(JSON.parse(readFileSync(new URL("../../public/models/rubert-tiny/intents.json", import.meta.url), "utf8")));
});

test("векторы примеров посчитаны для всех смыслов (иначе: node scripts/gen-intents.mjs)", () => {
  for (const it of INTENTS) assert.equal(table[it.id]?.length, it.anchors.length + 1, it.id);
});

test(`N3: фразы вне словаря (${OUTSIDE.length}) — словарь против словаря с моделью на устройстве`, async () => {
  let dictOk = 0;
  let modelOk = 0;
  let top3 = 0;
  const lines = [];
  for (const [phrase, want] of OUTSIDE) {
    const r = parseCommand(phrase);
    const d = dictIntent(r);
    const dHit = !!d && want.includes(d);
    if (dHit) dictOk++;
    let mHit = dHit;
    let t3 = dHit;
    let shown = d ? "словарь: " + d : "";
    if (!r.ok) {
      const ranked = rankIntents(await embedText(rt, phrase), table);
      const dec = decide(ranked);
      mHit = !!dec.pick && want.includes(dec.pick.id);
      t3 = dec.options.some((o) => want.includes(o.id));
      shown = (dec.pick ? "сразу: " + dec.pick.id : "варианты: " + dec.options.map((o) => o.id).join("/")) + ` (${ranked[0].id} ${ranked[0].score.toFixed(2)})`;
    }
    if (mHit) modelOk++;
    if (t3) top3++;
    lines.push(`${mHit ? "✓" : t3 ? "~" : "✗"} «${phrase}» → ${shown}`);
  }
  const pct = (n) => Math.round((n / OUTSIDE.length) * 1000) / 10 + "%";
  console.log(`Вне словаря (${OUTSIDE.length} фраз): словарь — ${dictOk} (${pct(dictOk)}); словарь + модель, выполнено верно сразу — ${modelOk} (${pct(modelOk)}); верное среди предложенных кнопок — ${top3} (${pct(top3)})`);
  console.log("  " + lines.join("\n  "));
  assert.ok(modelOk > dictOk, "модель должна понимать больше словаря");
  assert.ok(top3 / OUTSIDE.length >= 0.6, `верное среди вариантов: ${pct(top3)}`);
});

test("N3: модель не ломает понятные словарю фразы (они до неё не доходят)", () => {
  const understood = PHRASES.filter(([p, w]) => !mismatch(parseCommand(p), w)).length;
  assert.equal(understood, PHRASES.length);
});
