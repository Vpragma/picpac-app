// Разбор команд редактора словарём на устройстве (без сети).
// «сделай ярче», «чуть теплее», «убери пересвет», «намного контрастнее и холоднее», «не так ярко»…
// Результат: { ok: true, steps: [{ kind, ... }], say } или { ok: false, say: "Не понял…", suggestions }.
// Виды шагов:
//   adjust — { deltas: { exposure: +20, … } } (свет и цвет, применяется сразу);
//   auto — автоулучшение; undo — отменить шаг; reset — вернуть оригинал;
//   blurBackground, remove { target } — местные правки (S03c), creative { prompt } — облако (S03d).

export const SUGGESTIONS = ["Ярче", "Теплее", "Убрать пересвет", "Размыть фон", "Убрать солнце"];
const HELP = "«ярче», «чуть теплее», «убери пересвет», «больше контраста», «вернуть оригинал»";

const BASE = 20; // обычный шаг (из 100)

// Усилители и ослабители
const SOFT = /^(чуть|чуточку|чуть-чуть|немного|немножко|слегка|капельку|капельку|едва|самую|малость|незначительно|потихоньку)$/;
const STRONG = /^(сильнее|сильно|намного|гораздо|значительно|очень|куда|побольше|существенно|заметно|ощутимо|мощно)$/;
const MAX = /^(максимально|совсем|полностью|супер|максимум|предельно)$/;
const MORE = /^(еще|больше|прибавь|добавь|добавить|увеличь|увеличить|подними|поднять|повысь|повысить|усиль|усилить|плюс)$/;
const LESS = /^(меньше|убавь|убавить|уменьши|уменьшить|снизь|снизить|понизь|понизить|ослабь|ослабить|минус|убери|убрать|без|приглуши|приглушить)$/;
const NEG = /^(не|нет|ни)$/;

// Цели: стем → { key, dir } (dir — направление «как сказано», +1 или −1). Порядок важен: сначала длинные.
const TARGETS = [
  // составные — проверяются по фразе целиком
  { re: /(убер|убра|исправ|уменьш|меньше|без|сним|смягч|приглуш).{0,12}пересвет|пересвет.{0,12}(убер|убра|исправ|меньше|долой)/, steps: { highlights: -35, exposure: -10 }, say: "Смягчили пересвет" },
  { re: /^пересвет/, steps: { highlights: -35, exposure: -10 }, say: "Смягчили пересвет" },
  { re: /(осветл|высветл|светлее|ярче|подним|вытян|проработ|приподним).{0,14}тен|тен.{0,14}(светлее|ярче|осветл|вытян|подним)/, steps: { shadows: 30 }, say: "Осветлили тени" },
  { re: /(затемн|темнее|глубже|гуще).{0,14}тен|тен.{0,14}(темнее|глубже|гуще|затемн)/, steps: { shadows: -25 }, say: "Сделали тени глубже" },
  { re: /(цвет|краск).{0,14}(ярче|сочнее|насыщ|живее)|(ярче|сочнее|живее|насыщеннее).{0,14}(цвет|краск)/, steps: { saturation: 25 }, say: "Сделали цвета насыщеннее" },
  { re: /(цвет|краск).{0,14}(бледн|спокойн|тусклее|мягче)|(бледнее|спокойнее|приглуш|тусклее).{0,14}(цвет|краск)/, steps: { saturation: -25 }, say: "Сделали цвета спокойнее" },
  { re: /(желт|желтизн|оранж)/, neg: /(убер|убра|без|меньше|сним|исправ|долой)/, steps: { warmth: -25 }, negSay: "Убрали желтизну", say: "Сделали теплее", plus: { warmth: 25 } },
  { re: /(синев|голуб|син[еи])/, neg: /(убер|убра|без|меньше|сним|исправ|долой)/, steps: { warmth: 25 }, negSay: "Убрали синеву", say: "Сделали холоднее", plus: { warmth: -25 } },
  { re: /(черно-?бел|ч\/б|(^|\s)чб(\s|$)|монохром|обесцвет|бесцветн)/, steps: { saturation: -100 }, say: "Сделали чёрно-белым" },
];

const WORDS = [
  { re: /^(ярче|поярче|ярко|яркое|яркий|ярким|яркая|яркость|яркости|светлее|посветлее|светло|светлым|светлое|осветли|осветлить|высветли|освети|высвети|засвети|просветли|экспозиц\w*)$/, key: "exposure", dir: 1, up: "Сделали ярче", down: "Сделали темнее" },
  { re: /^(темнее|потемнее|темно|темное|темный|темным|темная|затемни|затемнить|притемни|притемнить|затемнее|мрачнее|темень)$/, key: "exposure", dir: -1, up: "Сделали ярче", down: "Сделали темнее" },
  { re: /^(контраст|контраста|контрасту|контрастом|контрастнее|контрастней|контрастное|контрастный|контрастным|контрастность|контрастности|сочнее|четче|резче|выразительнее)$/, key: "contrast", dir: 1, up: "Добавили контраста", down: "Сделали мягче" },
  { re: /^(мягче|помягче|мягкое|мягким|мягкий|спокойнее|бледнее|блеклое|тусклее|плоское|плосче)$/, key: "contrast", dir: -1, up: "Добавили контраста", down: "Сделали мягче" },
  { re: /^(теплее|потеплее|тепло|теплое|теплый|теплым|теплая|теплоты|тепла|утепли|согрей|уютнее|золотистее)$/, key: "warmth", dir: 1, up: "Сделали теплее", down: "Сделали холоднее" },
  { re: /^(холоднее|похолоднее|холодно|холодное|холодный|холодным|холодная|холода|остуди|прохладнее|свежее)$/, key: "warmth", dir: -1, up: "Сделали теплее", down: "Сделали холоднее" },
  { re: /^(насыщеннее|насыщенней|насыщенность|насыщенности|насыщенное|насыщенным|насыщенный|насыть|красочнее|красочное|живее|цветнее|сочность)$/, key: "saturation", dir: 1, up: "Сделали цвета насыщеннее", down: "Сделали цвета спокойнее" },
  { re: /^(блеклее|выцветшее|ненасыщенное|серее)$/, key: "saturation", dir: -1, up: "Сделали цвета насыщеннее", down: "Сделали цвета спокойнее" },
  { re: /^(светлые|светлых|светлым|блики|бликов|бликами|света)$/, key: "highlights", dir: 1, up: "Подняли светлые участки", down: "Приглушили светлые участки" },
  { re: /^(тени|теней|тенях|тень|тенями|тёмные|темные|темных)$/, key: "shadows", dir: 1, up: "Осветлили тени", down: "Сделали тени глубже" },
];

const LOCAL = [
  { re: /(размо|размыт|размыв|размаж|размой|бок[еэ]|фон.{0,10}(нечетк|размыт|мутн)|нечетк.{0,10}фон)/, kind: "blurBackground", say: "Размыть фон" },
  { re: /(убер|убра|удал|сотр|стер|без|спрячь|скрой|долой).{0,20}(солнц|солнышк)/, kind: "remove", target: "sun", say: "Убрать солнце" },
  { re: /(убер|убра|удал|сотр|стер|спрячь|скрой|долой).{0,20}(блик)/, kind: "remove", target: "glare", say: "Убрать блики" },
  {
    re: /(убер|убра|удал|сотр|стер|спрячь|скрой|долой)\S*\s+(\S+(\s+\S+)?)/,
    kind: "remove",
    say: "Убрать",
    pick: (m) => m[2],
  },
  { re: /(замени|поменяй|сделай|добавь|нарисуй).{0,12}(неб|закат|снег|дожд|радуг|облак|звезд|лун)/, kind: "creative", say: "Творческая правка" },
];

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„!?.;:()]/g, " ")
    .replace(/\s*,\s*/g, " , ")
    .replace(/\s+/g, " ")
    .trim();
}

function factorOf(tokens) {
  let f = 1;
  for (const t of tokens) {
    if (SOFT.test(t)) f = Math.min(f, 0.5);
    else if (MAX.test(t)) f = Math.max(f, 3);
    else if (STRONG.test(t)) f = Math.max(f, 2);
  }
  return f;
}

// Одна часть фразы (между «и» / запятыми) → шаг или null
function parsePart(part, ctx) {
  const tokens = part.split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const f = factorOf(tokens);

  // Управление
  if (/(верн|вернуть|сброс|сбрось|отмени|отменить).{0,16}(оригинал|исходн|как было|все правки|всё)|^(оригинал|исходник|как было)$|^сброс/.test(part))
    return { kind: "reset", say: "Вернули оригинал" };
  if (/^(отмени|отменить|отмена|назад|верни назад|откати|undo|верни)$|отмени.{0,10}(последн|шаг)|^не надо$|^не нужно$/.test(part)) return { kind: "undo", say: "Отменили последний шаг" };
  if (/(улучш|исправь все|исправь фото|поправь фото|сделай (лучше|красиво|хорошо|получше)|авто(матически)?\s*(улучш|коррекц)|^авто$|^исправь$|^поправь$|^(лучше|получше|красивее|красиво|покрасивее)$)/.test(part))
    return { kind: "auto", say: "Улучшили автоматически" };

  // Местные правки (S03c) и облако (S03d)
  for (const l of LOCAL) {
    const m = part.match(l.re);
    if (!m) continue;
    if (l.kind === "remove" && l.pick) {
      const what = l.pick(m).replace(/^(это|этот|эту|этого|с фото|с фотографии)\s*/, "").trim();
      if (!what || /пересвет|желт|синев|тен|шум|оттен/.test(what)) continue;
      return { kind: "remove", target: what, say: "Убрать: " + what };
    }
    return { kind: l.kind, ...(l.target ? { target: l.target } : {}), ...(l.kind === "creative" ? { prompt: part } : {}), say: l.say };
  }

  // Составные выражения
  for (const t of TARGETS) {
    if (!t.re.test(part)) continue;
    const negated = t.neg ? t.neg.test(part) : false;
    const base = t.neg ? (negated ? t.steps : t.plus) : t.steps;
    const deltas = Object.fromEntries(Object.entries(base).map(([k, v]) => [k, Math.round(v * f)]));
    return { kind: "adjust", deltas, say: t.neg ? (negated ? t.negSay : t.say) : t.say };
  }

  // Слова: цель + направление (+ отрицание, усилители, «больше/меньше»)
  let target = null;
  let tIdx = -1;
  for (let i = 0; i < tokens.length && !target; i++) {
    for (const w of WORDS) {
      if (w.re.test(tokens[i])) {
        target = w;
        tIdx = i;
        break;
      }
    }
  }
  if (!target) {
    // «сильнее», «ещё», «чуть-чуть» без цели — повторить последний шаг
    if (ctx?.last && tokens.every((t) => SOFT.test(t) || STRONG.test(t) || MAX.test(t) || MORE.test(t) || t === "еще" || t === "сделай" || t === "так" || t === "же")) {
      const k = f === 1 ? 1 : f;
      return { kind: "adjust", deltas: Object.fromEntries(Object.entries(ctx.last.deltas).map(([key, v]) => [key, Math.round((v / (ctx.last.f || 1)) * k)])), say: ctx.last.say + " ещё" };
    }
    return null;
  }
  let dir = target.dir;
  const before = tokens.slice(0, tIdx);
  const after = tokens.slice(tIdx + 1);
  const near = [...before.slice(-3), ...after.slice(0, 2)];
  if (near.some((t) => LESS.test(t))) dir = -Math.abs(dir) * Math.sign(target.dir || 1);
  else if (near.some((t) => MORE.test(t))) dir = Math.abs(dir) * Math.sign(target.dir || 1);
  // «светлые»/«тени» без направления: «светлые» — приглушить (так чаще просят), «тени» — осветлить
  if (target.key === "highlights" && !near.some((t) => MORE.test(t) || LESS.test(t))) dir = -1;
  if (before.slice(-3).some((t) => NEG.test(t)) || /^(слишком|чересчур)$/.test(before[before.length - 1] || "")) dir = -dir;
  const amount = Math.round(BASE * f);
  const deltas = { [target.key]: dir * amount };
  return { kind: "adjust", deltas, say: dir > 0 ? target.up : target.down, f };
}

// Разобрать фразу. ctx.last — последний шаг (для «ещё», «сильнее»)
export function parseCommand(text, ctx = {}) {
  const t = normalize(text);
  if (!t) return { ok: false, say: "Напишите, что изменить. Например: " + HELP, suggestions: SUGGESTIONS };
  const parts = t
    .replace(/^(пожалуйста|плиз|давай|можешь|можно)\s+/, "")
    .split(/\s*[,+]\s*|\s(?:и|а также|а еще|плюс|затем|потом|еще и)\s/)
    .map((p) => p.replace(/^(сделай|сделать|сделайте|пусть будет|хочу|нужно|надо|чтобы|фото|фотку|фотографию|картинку|пожалуйста|будет|станет|можно|а)\s+/g, "").trim())
    .map((p) => p.replace(/^(сделай|сделать|фото|фотку|чуть|немного)?\s*(сделай|сделать)\s+/, "").trim())
    .filter(Boolean);
  const steps = [];
  let last = ctx.last || null;
  for (const p of parts) {
    const s = parsePart(p, { last });
    if (!s) return { ok: false, say: `Не понял «${p}». Попробуйте: ${HELP}.`, suggestions: SUGGESTIONS };
    steps.push(s);
    if (s.kind === "adjust") last = s;
  }
  // Несколько правок света и цвета — одним шагом
  const adj = steps.filter((s) => s.kind === "adjust");
  const other = steps.filter((s) => s.kind !== "adjust");
  const merged = [];
  if (adj.length) {
    const deltas = {};
    for (const s of adj) for (const [k, v] of Object.entries(s.deltas)) deltas[k] = (deltas[k] || 0) + v;
    merged.push({ kind: "adjust", deltas, say: adj.map((s) => s.say).join(", "), f: adj[adj.length - 1].f });
  }
  return { ok: true, steps: [...merged, ...other], say: [...merged, ...other].map((s) => s.say).join("; ") };
}
