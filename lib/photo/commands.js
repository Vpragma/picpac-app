// Разбор команд редактора словарём на устройстве (без сети).
import { objectFromText } from "./objects.js";
// «сделай ярче», «чуть теплее», «убери пересвет», «намного контрастнее и холоднее», «не так ярко»…
// Результат: { ok: true, steps: [{ kind, ... }], say } или { ok: false, say: "Не понял…", suggestions }.
// Виды шагов:
//   adjust — { deltas: { exposure: +20, … } } (свет и цвет, применяется сразу);
//   auto — автоулучшение; undo — отменить шаг; reset — вернуть оригинал;
//   blurBackground, remove { target } — местные правки (S03c), creative { prompt } — облако (S03d);
//   maskTone { dir: +1 | −1 } — осветлить или затемнить выделенное касанием (D1); remove { target: "selection" } — убрать выделенное.
// N3 (всё на устройстве, облака нет):
//   adjust + look — стили-пресеты («ч/б», «сепия», «винтаж», «как в старом кино», «тёплый вечер», «осеннее настроение»…):
//     deltas — к ползункам, look — стиль { mono, sepia, fade } (lib/photo/adjust.js); look { kind: "look", look: null } — убрать стиль;
//   предмет словом: remove / maskBlur / maskTone / blurBackground / find с { classes, target, plural, where } —
//     классы детектора YOLOX (lib/photo/objects.js), редактор ищет предмет на устройстве и выделяет его SlimSAM;
//   опечатки («ярчи», «тепле», «контраз») исправляются по словарю команд (расстояние Дамерау — Левенштейна).

// D1: выделение касанием есть — «Размыть фон» вернулся в подсказки (без выделения редактор просит коснуться главного)
export const SUGGESTIONS = ["Ярче", "Теплее", "Убрать пересвет", "Размыть фон", "Ч/б", "Тёплый вечер"];
const HELP = "«ярче», «чуть теплее», «убери пересвет», «как в старом кино», «сепия», «размой фон», «убери машину»";

const BASE = 20; // обычный шаг (из 100)

// Усилители и ослабители
const SOFT = /^(чуть|чуточку|чуть-чуть|немного|немножко|слегка|капельку|капельку|едва|самую|малость|незначительно|потихоньку)$/;
const STRONG = /^(сильнее|сильно|намного|гораздо|значительно|очень|куда|побольше|существенно|заметно|ощутимо|мощно)$/;
const MAX = /^(максимально|совсем|полностью|супер|максимум|предельно)$/;
const MORE = /^(еще|больше|побольше|поболее|более|прибавь|прибавить|подбавь|добавь|добавить|увеличь|увеличить|подними|поднять|повысь|повысить|повыше|выше|усиль|усилить|плюс)$/;
const LESS = /^(меньше|поменьше|менее|пониже|ниже|убавь|убавить|поубавь|поубавить|сбавь|сбавить|уменьши|уменьшить|снизь|снизить|понизь|понизить|опусти|опустить|ослабь|ослабить|минус|убери|убрать|без|приглуши|приглушить)$/;
// Вежливые и пустые слова не мешают разбору: «сделай ярче, пожалуйста»
const FILLER = /(^|\s)(пожалуйста|пожалуй|плиз|плз|пж|пжл|please|спасибо|будь добр|будьте добры|если можно|если не сложно|если не трудно|можешь|можете|мне|ну|ка|давай|давайте)(?=\s|$)/g;
// «слишком», «не надо», «не», «-оватое» — жалоба: оттенок нужно убрать
const TOO_MUCH = /(убер|убра|без|меньше|сним|исправ|долой|слишком|чересчур|много|лишн|убав|уменьш|приглуш|перебор|переборщ|перестара|перегнул|(^|\s)не\s|(^|\s)нет\s|(^|\s)не$|оват|еват|(^|\s)очень\s+\S*(ое|ая|ый|ые|ой)(\s|$))/;
// S12: жалобы «перебор с яркостью», «многовато тепла» — значит, в обратную сторону
const COMPLAINT = /^(перебор|переборщил[а-я]*|перестарал[а-я]*|перегнул[а-я]*|многовато|многовата|слишком|чересчур|лишку|излишне)$/;
// «ярче не надо», «контраста не нужно» — отрицание после слова: ничего не меняем
const AFTER_NEG = /^(не|нет)$/;
const NEED = /^(надо|нужно|нужен|нужна|стоит|хочу|требуется|просил[а-я]*)$/;
const NEG = /^(не|нет|ни)$/;

// Цели: стем → { key, dir } (dir — направление «как сказано», +1 или −1). Порядок важен: сначала длинные.
const TARGETS = [
  // составные — проверяются по фразе целиком
  { re: /(убер|убра|исправ|уменьш|меньше|без|сним|смягч|приглуш).{0,12}пересвет|пересвет.{0,12}(убер|убра|исправ|меньше|долой)/, steps: { highlights: -35, exposure: -10 }, say: "Смягчили пересвет" },
  { re: /(^|\s)(пересве[тч]|засве[тч]ен|засвеч|засветк)/, steps: { highlights: -35, exposure: -10 }, say: "Смягчили пересвет" },
  { re: /(осветл|высветл|светлее|ярче|подним|вытян|проработ|приподним).{0,14}тен|тен.{0,14}(светлее|ярче|осветл|вытян|подним)/, steps: { shadows: 30 }, say: "Осветлили тени" },
  { re: /(затемн|темнее|глубже|гуще).{0,14}тен|тен.{0,14}(темнее|глубже|гуще|затемн)/, steps: { shadows: -25 }, say: "Сделали тени глубже" },
  { re: /(цвет|краск).{0,14}(ярче|сочнее|насыщ|живее)|(ярче|сочнее|живее|насыщеннее).{0,14}(цвет|краск)/, steps: { saturation: 25 }, say: "Сделали цвета насыщеннее" },
  { re: /(цвет|краск).{0,14}(бледн|спокойн|тусклее|мягче)|(бледнее|спокойнее|приглуш|тусклее).{0,14}(цвет|краск)/, steps: { saturation: -25 }, say: "Сделали цвета спокойнее" },
  { re: /(желт|желтизн|оранж)/, neg: TOO_MUCH, steps: { warmth: -25 }, negSay: "Убрали желтизну", say: "Сделали теплее", plus: { warmth: 25 } },
  { re: /(синев|голуб|син[еи])/, neg: TOO_MUCH, steps: { warmth: 25 }, negSay: "Убрали синеву", say: "Сделали холоднее", plus: { warmth: -25 } },
  // N3: «убери красноту», «слишком розовое» — красный оттенок
  { re: /(красн|покраснен|розов|малинов|пурпурн)/, neg: TOO_MUCH, steps: { warmth: -15, saturation: -10 }, negSay: "Убрали красноту", say: "Сделали теплее и насыщеннее", plus: { warmth: 15, saturation: 10 } },
];

const WORDS = [
  { re: /^(ярче|поярче|ярко|яркое|яркий|ярким|яркая|яркой|яркость|яркости|яркостью|светлее|посветлее|светло|светлым|светлое|осветли|осветлить|высветли|освети|высвети|засвети|просветли|свет|света|свету|светом|экспозиц[а-я]*)$/, key: "exposure", dir: 1, up: "Сделали ярче", down: "Сделали темнее" },
  // жалобы «-вато»: «темновато» — значит, сделать ярче
  { re: /^(темноват[а-я]*|мрачноват[а-я]*|тускловат[а-я]*|недосвечен[а-я]*|недоэкспонир[а-я]*)$/, key: "exposure", dir: 1, up: "Сделали ярче", down: "Сделали темнее" },
  { re: /^(светловат[а-я]*|ярковат[а-я]*)$/, key: "exposure", dir: -1, up: "Сделали ярче", down: "Сделали темнее" },
  { re: /^(холодноват[а-я]*)$/, key: "warmth", dir: 1, up: "Сделали теплее", down: "Сделали холоднее" },
  { re: /^(тепловат[а-я]*)$/, key: "warmth", dir: -1, up: "Сделали теплее", down: "Сделали холоднее" },
  { re: /^(бледноват[а-я]*|блекловат[а-я]*|сероват[а-я]*)$/, key: "saturation", dir: 1, up: "Сделали цвета насыщеннее", down: "Сделали цвета спокойнее" },
  { re: /^(резковат[а-я]*|контрастноват[а-я]*)$/, key: "contrast", dir: -1, up: "Добавили контраста", down: "Сделали мягче" },
  { re: /^(плосковат[а-я]*|мутноват[а-я]*|вяловат[а-я]*)$/, key: "contrast", dir: 1, up: "Добавили контраста", down: "Сделали мягче" },
  { re: /^(темнее|потемнее|темно|темное|темный|темным|темная|затемни|затемнить|притемни|притемнить|затемнее|мрачнее|темень)$/, key: "exposure", dir: -1, up: "Сделали ярче", down: "Сделали темнее" },
  { re: /^(контраст[а-я]*|сочнее|четче|резче|выразительнее)$/, key: "contrast", dir: 1, up: "Добавили контраста", down: "Сделали мягче" },
  { re: /^(мягче|помягче|мягкое|мягким|мягкий|спокойнее|бледнее|блеклое|тусклее|плоское|плосче)$/, key: "contrast", dir: -1, up: "Добавили контраста", down: "Сделали мягче" },
  { re: /^(теплее|потеплее|тепло|теплое|теплый|теплым|теплая|теплой|теплоты|теплота|тепла|теплу|утепли|согрей|уютнее|золотистее)$/, key: "warmth", dir: 1, up: "Сделали теплее", down: "Сделали холоднее" },
  { re: /^(холоднее|похолоднее|холодно|холодное|холодный|холодным|холодная|холода|остуди|прохладнее|свежее)$/, key: "warmth", dir: -1, up: "Сделали теплее", down: "Сделали холоднее" },
  { re: /^(насыщеннее|насыщенней|насыщенность|насыщенности|насыщенностью|насыщенное|насыщенным|насыщенный|насыщенно|насыть|красочнее|красочное|живее|цветнее|сочность)$/, key: "saturation", dir: 1, up: "Сделали цвета насыщеннее", down: "Сделали цвета спокойнее" },
  { re: /^(блеклее|выцветшее|ненасыщенное|серее)$/, key: "saturation", dir: -1, up: "Сделали цвета насыщеннее", down: "Сделали цвета спокойнее" },
  { re: /^(светлые|светлых|блики|бликов|бликами)$/, key: "highlights", dir: 1, up: "Подняли светлые участки", down: "Приглушили светлые участки" },
  { re: /^(тени|теней|тенях|тень|тенями|тёмные|темные|темных)$/, key: "shadows", dir: 1, up: "Осветлили тени", down: "Сделали тени глубже" },
];

// N3: стили-пресеты. deltas — к ползункам (как команда), look — стиль { mono, sepia, fade } поверх (заменяет прежний).
// Порядок важен: сначала длинные и особые («нуар», «старое кино»), потом общие («ч/б»).
export const PRESETS = [
  { id: "noir", name: "Нуар", re: /(нуар|noir|черно-?\s?бел\S*\s+и\s+(контрастн|мрачн|драм))/, deltas: { saturation: -100, contrast: 35, shadows: -15 }, look: { mono: 100 }, say: "Нуар: чёрно-белое и контрастное" },
  {
    id: "oldfilm",
    name: "Старое кино",
    re: /((стар\S*|старинн\S*|ретро|нем(ое|ого|ом)|черно-?\s?бел\S*|советск\S*)\s+(кино|фильм\S*|кинофильм\S*|кинохроник\S*|синема)|(кино|фильм\S*)\s+(стар\S*|прошл\S*|\d\d-?х)|кинохроник|как в кино\S* (прошлого|прошлых)|синематограф|чаплин)/,
    deltas: { saturation: -100, contrast: 15 },
    look: { mono: 100, fade: 30 },
    say: "Как в старом кино: чёрно-белое и мягкое",
  },
  {
    id: "oldphoto",
    name: "Старое фото",
    re: /((стар\S*|старинн\S*|давн\S*|архивн\S*|бабушкин\S*|дедушкин\S*|дореволюц\S*)\s+(фото\S*|снимк\S*|снимок|карточк\S*|альбом\S*|открытк\S*)|под старину|состар\S*|как в прошлом веке|(фото|снимок)\s+(из прошлого|прошлого века))/,
    deltas: { contrast: -10 },
    look: { sepia: 70, fade: 30 },
    say: "Как старое фото: сепия и мягкие тени",
  },
  { id: "sepia", name: "Сепия", re: /(сепи|сэпи|коричнев\S*\s+(тон|оттен|цвет)|в коричнев|под кофе|кофейн\S*\s+тон)/, deltas: { contrast: -5 }, look: { sepia: 85 }, say: "Сделали в тонах сепии" },
  {
    id: "vintage",
    name: "Винтаж",
    re: /(винтаж|винтед|вентаж|ретро|пл[её]нк|пл[её]ночн|полароид|поларойд|олдскул|lomo|ломо(графи)?|как на мыльниц|выцветш\S*\s+(стил|фильтр|эффект)|старый фильтр)/,
    deltas: { saturation: -25, contrast: -10, warmth: 15 },
    look: { fade: 40, sepia: 20 },
    say: "Винтаж: приглушённые цвета и тёплый оттенок",
  },
  { id: "bw", name: "Чёрно-белое", re: /(черно-?\s?бел|чернобел|ч\/б|(^|\s)ч\s?б(\s|$)|(^|\s)ч-б(\s|$)|монохром|без цвета|бесцветн|обесцвет|оттенк\S*\s+сер|сер\S*\s+тон|grayscale|b\/w)/, deltas: { saturation: -100, contrast: 10 }, look: { mono: 100 }, say: "Сделали чёрно-белым" },
  {
    id: "evening",
    name: "Тёплый вечер",
    re: /(тепл\S*\s+(вечер|закат)|вечерн\S*|золот\S*\s+час|закатн\S*\s+(свет|настроен|тон|краск)|как на закате|как в закат|уютн\S*\s+вечер|(^|\s)вечер(ом)?(\s|$))/,
    deltas: { warmth: 45, exposure: -8, saturation: 10, highlights: -10 },
    say: "Тёплый вечер: теплее и мягче свет",
  },
  { id: "autumn", name: "Осеннее настроение", re: /(осен|листопад|по-?осеннему)/, deltas: { warmth: 35, saturation: 20, contrast: 10, shadows: -5 }, say: "Осеннее настроение: теплее и насыщеннее" },
  { id: "winter", name: "Зимнее настроение", re: /((^|\s)зим|по-?зимнему|морозн|ледян\S*\s+(тон|оттен|цвет|настроен))/, deltas: { warmth: -35, exposure: 8, saturation: -10, highlights: 5 }, say: "Зимнее настроение: прохладнее и светлее" },
  { id: "spring", name: "Весеннее настроение", re: /(весн|весен|по-?весеннему)/, deltas: { exposure: 10, saturation: 15, warmth: 5, shadows: 10 }, say: "Весеннее настроение: свежо и светло" },
  {
    id: "summer",
    name: "Ярко, как летом",
    re: /((^|\s)лет(ом|о|нее|нее|няя|нюю|ний|него|нем)(\s|$)|по-?летнему|солнечн|как летом|ярк\S*\s+как\s+лет|южн\S*\s+(солнц|свет)|отпускн)/,
    deltas: { exposure: 12, saturation: 30, warmth: 12, contrast: 10 },
    say: "Ярко, как летом",
  },
  { id: "soft", name: "Нежно", re: /(пастел|нежн|воздушн|мягк\S*\s+(тон|цвет|свет|стил)|романтичн|дымк)/, deltas: { contrast: -25, saturation: -15, exposure: 8, highlights: -10 }, look: { fade: 15 }, say: "Нежные пастельные тона" },
  { id: "drama", name: "Драматично", re: /(драм|эпичн|эффектн|мрачн\S*\s+(настроен|атмосфер|стил|тон)|грозов\S*\s+(настроен|тон)|контрастн\S*\s+и\s+мрачн)/, deltas: { contrast: 35, shadows: -20, highlights: -15, saturation: -10 }, say: "Драматичнее: глубже тени и больше контраста" },
  { id: "cinema", name: "Как в кино", re: /(кинематограф|как в (кино|фильме|голливуд)|киношн|блокбастер)/, deltas: { contrast: 20, saturation: -15, warmth: 10, shadows: -10 }, look: { fade: 12 }, say: "Как в кино: контрастнее и сдержаннее цвета" },
  { id: "vivid", name: "Сочно", re: /(инстаграм|instagram|инсту|как в рекламе|вырвиглаз|кислотн|ярк\S*\s+и\s+сочн|сочн\S*\s+и\s+ярк|сочн(о|ые|ая|ые цвета)$|(^|\s)сочн(о|ые|ая)\s+(фото|картинк|цвет))/, deltas: { saturation: 30, contrast: 15, exposure: 5 }, say: "Сочно: насыщеннее и контрастнее" },
];

// «Верни цвет», «убери фильтр», «без ч/б» — убрать стиль
const UNLOOK = /(^|\s)(верн\S*\s+)?(цвет(а|ное|ным|ную)?|в цвет[еу]?)$|(^|\s)цветн(ое|ым|ая|ую)(\s|$)|(убер|убра|сним|отмени|отключ|выключ)\S*\s+(фильтр|стил|эффект|ч\/б|чб|черно-?\s?бел|сепи|винтаж|пресет|обработк)|без\s+(фильтр|стил|эффект|пресет)/;

// N3: предмет словом. Глагол → действие; после глагола — предмет (lib/photo/objects.js)
const VERB_OBJ = [
  { re: /^(размо\S*|разм[ао]ж\S*|размыть|размыв\S*|замыл\S*|замаж\S*|заблюр\S*|блюр\S*|пикселиз\S*|расфокус\S*)$/, act: "blur" },
  { re: /^(осветл\S*|высветл\S*|подсвет\S*|подсвéт\S*)$/, act: "lighten" },
  { re: /^(затемн\S*|притемн\S*|затени\S*|приглуш\S*)$/, act: "darken" },
  { re: /^(убер\S*|убра\S*|удал\S*|сотр\S*|стер\S*|долой|спрячь|скрой|вырежи|вырез\S*|убир\S*|избав\S*)$/, act: "erase" },
  { re: /^(найди|найти|выдели|выделить|выделите|покажи|отметь|отметить)$/, act: "select" },
];
// «собаку светлее», «машину темнее», «сделай кота размытым» — без глагола в начале
const ADJ_OBJ = [
  { re: /^(светлее|посветлее|ярче|поярче|светлой|светлым|ярким|яркой)$/, act: "lighten" },
  { re: /^(темнее|потемнее|темной|темным|мрачнее)$/, act: "darken" },
  { re: /^(размыт\S*|нечетк\S*|мутн\S*|неразличим\S*)$/, act: "blur" },
];

function objectStep(part) {
  const tokens = part.split(" ").filter((t) => t && t !== ",");
  for (let i = 0; i < tokens.length; i++) {
    const v = VERB_OBJ.find((x) => x.re.test(tokens[i]));
    if (!v) continue;
    // Предмет обычно после глагола («убери машину»), но бывает и до («собаку размой»)
    let rest = tokens.slice(i + 1);
    if (!rest.length || (!objectFromText(rest.join(" ")) && objectFromText(tokens.slice(0, i).join(" ")))) rest = [...tokens.slice(0, i), ...tokens.slice(i + 1)];
    let restText = rest.join(" ");
    if (!objectFromText(restText) && !/(^|\s)(фон\S*|задн\S*)(\s|$)/.test(restText)) {
      const fixed = fixTypos(restText); // «сабаку», «чилавека», «машыну»
      if (objectFromText(fixed)) {
        rest = fixed.split(" ");
        restText = fixed;
      }
    }
    // «размой фон вокруг собаки», «размой всё кроме человека» — фон, а предмет остаётся чётким
    if (v.act === "blur" && /(^|\s)(фон\S*|задн\S*|кроме|вокруг|позади|сзади|окружени\S*)(\s|$)/.test(restText)) {
      const subj = objectFromText(restText.replace(/(^|\s)(фон\S*|задн\S*\s+план\S*)(\s|$)/g, " "));
      if (!subj) return null; // просто «размой фон» — обычное правило
      return { kind: "blurBackground", classes: subj.classes, target: subj.say, plural: subj.plural, where: subj.where, say: "Размыть фон вокруг: " + subj.say };
    }
    const obj = objectFromText(restText);
    if (!obj) return null;
    const target = rest.slice(0, 2).join(" ").replace(/^(это|этот|эту|этого|с фото|с фотографии)\s*/, "").trim() || obj.say;
    const base = { target, classes: obj.classes, plural: obj.plural, where: obj.where, objSay: obj.say };
    if (v.act === "erase") return { kind: "remove", ...base, say: "Убрать: " + target };
    if (v.act === "blur") return { kind: "maskBlur", ...base, say: "Размыть: " + target };
    if (v.act === "lighten") return { kind: "maskTone", dir: 1, ...base, say: "Осветлить: " + target };
    if (v.act === "darken") return { kind: "maskTone", dir: -1, ...base, say: "Затемнить: " + target };
    return { kind: "find", ...base, say: "Найти: " + target };
  }
  const adj = tokens.map((t) => ADJ_OBJ.find((x) => x.re.test(t))).find(Boolean);
  if (!adj) return null;
  const obj = objectFromText(part);
  if (!obj) return null;
  const base = { target: obj.word, classes: obj.classes, plural: obj.plural, where: obj.where, objSay: obj.say };
  if (adj.act === "blur") return { kind: "maskBlur", ...base, say: "Размыть: " + obj.word };
  return { kind: "maskTone", dir: adj.act === "lighten" ? 1 : -1, ...base, say: (adj.act === "lighten" ? "Осветлить: " : "Затемнить: ") + obj.word };
}

const LOCAL_FIRST = [
  // D1: правки выделенного касанием — «осветли выделенное», «затемни его», «убери выделенное»
  { re: /(осветл|ярче|светлее|высветл).{0,16}(выделен|предмет|объект|отмечен)|(выделен|предмет|объект|отмечен)\S*.{0,16}(осветл|ярче|светлее)/, kind: "maskTone", dir: 1, say: "Осветлить выделенное" },
  { re: /(затемн|темнее|притемн).{0,16}(выделен|предмет|объект|отмечен)|(выделен|предмет|объект|отмечен)\S*.{0,16}(затемн|темнее)/, kind: "maskTone", dir: -1, say: "Затемнить выделенное" },
  { re: /(убер|убра|удал|сотр|стер|спрячь|скрой|долой)\S*\s+(выделен|отмечен|это$|этот предмет|предмет$|объект$)/, kind: "remove", target: "selection", say: "Убрать выделенное" },
  { re: /(убер|убра|удал|сотр|стер|без|спрячь|скрой|долой).{0,20}(солнц|солнышк)/, kind: "remove", target: "sun", say: "Убрать солнце" },
  { re: /(убер|убра|удал|сотр|стер|спрячь|скрой|долой).{0,20}(блик)/, kind: "remove", target: "glare", say: "Убрать блики" },
];

// После поиска предмета словом (objectStep): размытие фона, «убери X» (неизвестный предмет), творческие правки
const LOCAL = [
  { re: /(размо|размыт|размыв|размаж|размой|бок[еэ]|фон.{0,10}(нечетк|размыт|мутн)|нечетк.{0,10}фон)/, kind: "blurBackground", say: "Размыть фон" },
  {
    re: /(убер|убра|удал|сотр|стер|спрячь|скрой|долой)\S*\s+(\S+(\s+\S+)?)/,
    kind: "remove",
    say: "Убрать",
    pick: (m) => m[2],
  },
  { re: /(замени|поменяй|сделай|добавь|нарисуй).{0,12}(неб|закат|снег|дожд|радуг|облак|звезд|лун)/, kind: "creative", say: "Творческая правка" },
  // S12: «сделай небо закатным» — глагол уже срезан, остаётся «небо закатным»
  { re: /(^|\s)неб\S*.{0,20}(закат|снеж|снег|звезд|радуг|облач|облак|драмат|ночн|розов|грозов|рассвет)|(закат|снеж|звезд|радуг|облач|драмат|ночн|розов|грозов|рассвет)\S*\s+неб/, kind: "creative", say: "Творческая правка" },
];

// «Сделали ярче» → «Сделали ещё ярче» (без «ещё ещё»)
function sayMore(say) {
  const s = String(say || "").replace(/\s+ещё$/, "");
  if (/(^|\s)ещё(\s|$)/.test(s)) return s;
  return s.replace(/^(\S+)\s+/, "$1 ещё ");
}

export function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„!?.;:()%]/g, " ")
    .replace(/\+\s*(\d)/g, " плюс $1")
    .replace(/(^|\s)[-−–]\s*(\d)/g, "$1минус $2")
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
  // «поконтрастнее», «понасыщеннее», «посочнее» → без «по» (если остаток — сравнительная степень)
  const tokens = part
    .split(" ")
    .filter(Boolean)
    .map((t) => (/^по[а-я]{4,}(ее|ей)$/.test(t) && !/^по(звон|сл|ро|д|т)/.test(t) ? t.slice(2) : t));
  if (!tokens.length) return null;
  const f = factorOf(tokens);

  // Управление
  if (/(верн|вернуть|сброс|сбрось|отмени|отменить).{0,16}(оригинал|исходн|как было|все правки|всё)|^(оригинал|исходник|как было)$|^сброс/.test(part))
    return { kind: "reset", say: "Вернули оригинал" };
  if (/^(отмени|отменить|отмена|назад|верни назад|откати|undo|верни)$|отмени.{0,10}(последн|шаг)|^не надо$|^не нужно$/.test(part)) return { kind: "undo", say: "Отменили последний шаг" };
  if (/(улучш|исправь все|исправь фото|поправь фото|(исправ|поправ|выровня|настро)\S*\s+(цвет|баланс|свет|экспозиц)|баланс белого|естествен|натуральн|как в жизни|сделай (лучше|красиво|хорошо|получше)|авто(матически)?\s*(улучш|коррекц)|^авто$|^исправь$|^поправь$|^(лучше|получше|красивее|красиво|покрасивее)$)/.test(part))
    return { kind: "auto", say: "Улучшили автоматически" };

  // N3: убрать стиль и стили-пресеты («ч/б», «сепия», «как в старом кино», «тёплый вечер»…)
  if (UNLOOK.test(part) && !/(^|\s)без\s+цвет/.test(part)) return { kind: "look", look: null, say: "Убрали стиль — цвета как были" };
  for (const p of PRESETS) {
    if (!p.re.test(part)) continue;
    // «чуть-чуть винтажа» — слабее, «очень драматично» — сильнее (стиль look — как есть)
    const k = f === 1 ? 1 : Math.min(1.5, f);
    const deltas = Object.fromEntries(Object.entries(p.deltas).map(([key, v]) => [key, Math.max(-100, Math.min(100, Math.round(v * k)))]));
    return { kind: "adjust", deltas, ...(p.look ? { look: p.look } : {}), preset: p.id, say: p.say, f: 1 };
  }

  // Местные правки: выделенное касанием, «убери солнце/блики»
  const local = (list) => {
    for (const l of list) {
      const m = part.match(l.re);
      if (!m) continue;
      if (l.kind === "remove" && l.pick) {
        const what = l.pick(m).replace(/^(это|этот|эту|этого|с фото|с фотографии)\s*/, "").trim();
        if (!what || /пересве|засве|желт|синев|красн|розов|тен|шум|оттен|ярк|контраст|насыщ|тепл|холод|свет|фильтр|стил|эффект/.test(what)) continue;
        return { kind: "remove", target: what, say: "Убрать: " + what };
      }
      return { kind: l.kind, ...(l.target ? { target: l.target } : {}), ...(l.dir ? { dir: l.dir } : {}), ...(l.kind === "creative" ? { prompt: part } : {}), say: l.say };
    }
    return null;
  };
  const first = local(LOCAL_FIRST);
  if (first) return first;
  // N3: предмет словом («убери машину», «размой собаку», «осветли человека справа») — детектор на устройстве
  const obj = objectStep(part);
  if (obj) return obj;
  const rest = local(LOCAL);
  if (rest) return rest;

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
      return { kind: "adjust", deltas: Object.fromEntries(Object.entries(ctx.last.deltas).map(([key, v]) => [key, Math.round((v / (ctx.last.f || 1)) * k)])), say: sayMore(ctx.last.say) };
    }
    return null;
  }
  let dir = target.dir;
  const num = tokens.find((t) => /^\d{1,3}$/.test(t));
  const before = tokens.slice(0, tIdx);
  const after = tokens.slice(tIdx + 1);
  // «ярче не надо», «теплее не нужно», «контраста не надо» — просят не менять
  if (AFTER_NEG.test(after[0] || "") && (NEED.test(after[1] || "") || after.length === 1)) return { kind: "keep", say: "Понял, оставляю как есть" };
  // «перебор с яркостью», «многовато тепла», «слишком ярко» — жалоба: в обратную сторону
  // «очень тёмное», «очень яркое» — описание (именительный падеж) с «очень» — тоже жалоба; «сделай очень ярким» — просьба
  // N3: «фото тёмное», «тёмная фотка», «снимок слишком холодный» — описание фото, а не просьба: тоже жалоба
  const described = /(ое|ая|ый|ые|ий)$/.test(tokens[tIdx]) && (before.some((t) => /^(очень|совсем|какое-то|какой-то|какая-то)$/.test(t)) || !!ctx?.desc);
  if (described || tokens.some((t, i) => i !== tIdx && COMPLAINT.test(t))) {
    const d = -Math.abs(target.dir) * Math.sign(target.dir || 1);
    const amt = num ? Math.min(100, Number(num)) : Math.round(BASE * f);
    return { kind: "adjust", deltas: { [target.key]: d * amt }, say: d > 0 ? target.up : target.down, f };
  }
  const near = [...before.slice(-3), ...after.slice(0, 2)];
  if (near.some((t) => LESS.test(t))) dir = -Math.abs(dir) * Math.sign(target.dir || 1);
  else if (near.some((t) => MORE.test(t))) dir = Math.abs(dir) * Math.sign(target.dir || 1);
  // «светлые»/«тени» без направления: «светлые» — приглушить (так чаще просят), «тени» — осветлить
  if (target.key === "highlights" && !near.some((t) => MORE.test(t) || LESS.test(t))) dir = -1;
  if (before.slice(-3).some((t) => NEG.test(t)) || /^(слишком|чересчур)$/.test(before[before.length - 1] || "")) dir = -dir;
  const amount = num ? Math.min(100, Number(num)) : Math.round(BASE * f);
  const deltas = { [target.key]: dir * amount };
  return { kind: "adjust", deltas, say: dir > 0 ? target.up : target.down, f };
}

// «Сделали ярче», «Сделали теплее», «Добавили контраста» → «Сделали ярче и теплее, добавили контраста»
export function joinSays(list) {
  const parts = [];
  let verb = null;
  for (const say of list.filter(Boolean)) {
    const [v, ...rest] = say.split(" ");
    const tail = rest.join(" ");
    if (verb === v && tail) parts.push(tail);
    else {
      parts.push(parts.length ? say[0].toLowerCase() + say.slice(1) : say);
      verb = v;
    }
  }
  if (parts.length < 2) return parts[0] || "";
  return parts.slice(0, -1).join(", ") + " и " + parts[parts.length - 1];
}

// Разобрать фразу. ctx.last — последний шаг (для «ещё», «сильнее»)
export function parseCommand(text, ctx = {}) {
  const t = normalize(text).replace(FILLER, " ").replace(/\s+/g, " ").replace(/^[\s,]+|[\s,]+$/g, "").trim();
  if (!t) return { ok: false, say: "Напишите, что изменить. Например: " + HELP, suggestions: SUGGESTIONS };
  const raw = t
    .replace(/^(пожалуйста|плиз|давай|можешь|можно)\s+/, "")
    .split(/\s*[,+]\s*|\s(?:и|а также|а еще|затем|потом|еще и)\s|\sплюс\s(?!\d)/);
  // «фото тёмное», «тёмная фотка» — описание без глагола: значит, жалоба
  const SUBJ = /(^|\s)(фото|фотка|фотография|снимок|картинка|кадр|изображение)(\s|$)/;
  const descOf = (p) => SUBJ.test(p) && !/(^|\s)(сделай|сделать|сделайте|пусть|хочу|нужно|надо)(\s|$)/.test(p);
  const strip = (p) =>
    p
      .replace(/^(сделай|сделать|сделайте|пусть будет|хочу|нужно|надо|чтобы|фото|фотку|фотографию|картинку|пожалуйста|будет|станет|можно|а)\s+/g, "")
      .trim()
      .replace(/^(сделай|сделать|фото|фотку|чуть|немного)?\s*(сделай|сделать)\s+/, "")
      .trim();
  const parts = raw.map((p) => ({ p: strip(p), desc: descOf(p) })).filter((x) => x.p);
  const steps = [];
  let last = ctx.last || null;
  for (const { p, desc } of parts) {
    // Не разобрали — может, опечатка: «ярчи», «тепле», «контраз», «сепею», «сабаку»
    let s = parsePart(p, { last, desc });
    if (!s) {
      const fixed = fixTypos(p);
      if (fixed !== p) s = parsePart(fixed, { last, desc });
    }
    if (!s) return { ok: false, say: `Не понял «${p}». Попробуйте: ${HELP}.`, suggestions: SUGGESTIONS };
    steps.push(s);
    if (s.kind === "adjust") last = s;
  }
  // Несколько правок света и цвета — одним шагом (стили складываются: по каждому — сильнейшее)
  const adj = steps.filter((s) => s.kind === "adjust");
  const other = steps.filter((s) => s.kind !== "adjust");
  const merged = [];
  if (adj.length) {
    const deltas = {};
    let look;
    for (const s of adj) {
      for (const [k, v] of Object.entries(s.deltas)) deltas[k] = Math.max(-100, Math.min(100, (deltas[k] || 0) + v));
      if (s.look) {
        look = { ...(look || {}) };
        for (const [k, v] of Object.entries(s.look)) look[k] = Math.max(look[k] || 0, v);
      }
    }
    const preset = adj.map((s) => s.preset).filter(Boolean);
    merged.push({ kind: "adjust", deltas, ...(look ? { look } : {}), ...(preset.length ? { preset: preset.join("+") } : {}), say: joinSays(adj.map((s) => s.say)), f: adj[adj.length - 1].f });
  }
  return { ok: true, steps: [...merged, ...other], say: [...merged, ...other].map((s) => s.say).join("; ") };
}

// ---------- Опечатки ----------
// Слова, которые понимает словарь; неизвестное слово заменяем ближайшим (Дамерау — Левенштейн: 1 правка
// для слов от 4 букв, 2 — от 8 букв). Только если фраза без исправления не разобралась.
const VOCAB = (
  "ярче поярче светлее посветлее темнее потемнее теплее потеплее холоднее похолоднее контрастнее контраст контраста " +
  "насыщеннее насыщенность насыщенности яркость яркости мягче помягче резче четче сочнее бледнее тусклее осветли затемни " +
  "размой размыть убери убрать удали сотри верни вернуть отмени отменить улучши исправь оригинал пересвет пересвечено засвечено " +
  "тени теней светлые блики солнце фон боке сепия сепию винтаж винтажное винтажно ретро черно-белое черно-белым монохром нуар " +
  "пленка полароид старом старое старинное кино фильм фильма вечер вечерний закат осеннее осень летнее летом зимнее весеннее " +
  "пастель нежнее нежно драматично драматичнее кинематографично желтизну синеву оттенок цвета цветное фильтр стиль " +
  "собаку собака кошку кошка кота человека людей машину машина велосипед мотоцикл автобус птицу лошадь мяч сумку бутылку стул зонт " +
  "найди выдели выделенное"
).split(" ");
const VOCAB_SET = new Set(VOCAB);

function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      best = Math.min(best, d[i][j]);
    }
    if (best > max) return max + 1;
  }
  return d[a.length][b.length];
}

export function fixTypos(part) {
  return part
    .split(" ")
    .map((t) => {
      if (t.length < 4 || VOCAB_SET.has(t) || /\d/.test(t)) return t;
      const max = t.length >= 7 ? 2 : 1;
      let best = t;
      let bestD = max + 1;
      for (const v of VOCAB) {
        const dd = editDistance(t, v, max);
        if (dd < bestD) {
          bestD = dd;
          best = v;
        }
      }
      return best;
    })
    .join(" ");
}
