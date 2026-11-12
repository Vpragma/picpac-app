// Облачный ИИ (D6): общее для браузера и сервера. Без ключей и без сетевых вызовов.
// - пределы и тексты ошибок;
// - перевод слова-цели («машину» → "car") для поиска предмета;
// - перевод ответа облака в шаги редактора — только то, что редактор уже умеет;
// - рамки поиска и обрезка маски по рамке.

export const CLOUD_LIMITS = {
  perUserDay: 20, // облачных правок в сутки (UTC) на пользователя
  budgetDay: 8000, // нейронов в сутки на всё приложение (бесплатно Cloudflare даёт 10 000)
  perMinute: 10, // запросов в минуту на пользователя
  timeoutMs: 30_000,
  detectSide: 768, // длинная сторона кадра для поиска предмета
  editSide: 512, // длинная сторона вырезки для творческой правки
  maxBodyBytes: 2_000_000, // тело запроса (предел Vercel — 4,5 МБ)
};

export const CONSENT_TEXT = "Фото отправится в Cloudflare для обработки и не сохраняется.";
export const CONSENT_VERSION = 1;

export const CLOUD_SAY = {
  guest: "Облачный ИИ — только для вошедших. Войдите в аккаунт, а пока работают правки на телефоне.",
  consent: "Нужно согласие на облачный ИИ.",
  quota: "Лимит облачных правок на сегодня исчерпан, правки на телефоне работают.",
  unavailable: "Облачный ИИ сейчас недоступен — правки на телефоне работают.",
  offline: "Нет связи с облачным ИИ — правки на телефоне работают.",
  notFound: "Не нашёл это на фото. Коснитесь того, что убрать.",
};

// ─── Слово-цель по-русски → английское (Moondream понимает английский) ───
// Корни слов: «машину», «машины», «машиной» → car. Проверяется начало каждого слова.
const TARGETS = [
  [/^(человек|людей|люди|людям|мужчин|мужик|женщин|девушк|парн|парен|ребен|ребён|детей|дети|мальчик|девочк|прохож|турист|фотограф)/, "person"],
  [/^(машин|автомоб|авто$|тачк|джип|такси)/, "car"],
  [/^(велосипед|велик)/, "bicycle"],
  [/^(мотоцикл|мопед|байк|скутер)/, "motorcycle"],
  [/^(самол[её]т)/, "airplane"],
  [/^(автобус|маршрутк)/, "bus"],
  [/^(поезд|электрич|трамва)/, "train"],
  [/^(грузовик|фур[аыу]?$)/, "truck"],
  [/^(лодк|катер|корабл|яхт)/, "boat"],
  [/^(светофор)/, "traffic light"],
  [/^(скамейк|скамь|лавк|лавочк)/, "bench"],
  [/^(птиц|голуб|воробь|чайк|утк|ворон)/, "bird"],
  [/^(кошк|кошек|кот$|кота$|коту$|котом$|коты$|котов$|кот[её]н|котик|кис)/, "cat"],
  [/^(собак|пс[аыу]$|пес$|пёс$|щен|песик|пёсик)/, "dog"],
  [/^(лошад|кон[ьяю]$|пони)/, "horse"],
  [/^(овц|овец|баран)/, "sheep"],
  [/^(коров|бык)/, "cow"],
  [/^(рюкзак)/, "backpack"],
  [/^(зонт)/, "umbrella"],
  [/^(сумк|сумочк|пакет)/, "bag"],
  [/^(чемодан)/, "suitcase"],
  [/^(мяч|мячик)/, "ball"],
  [/^(воздушн.*зме|зме[йя])/, "kite"],
  [/^(бутылк|бутыл)/, "bottle"],
  [/^(бокал|стакан)/, "glass"],
  [/^(чашк|кружк)/, "cup"],
  [/^(тарелк|миск)/, "plate"],
  [/^(стул|стуль|кресл)/, "chair"],
  [/^(диван)/, "couch"],
  [/^(цвет(ок|ы|ов|ка)|букет|растени|горшок)/, "flower"],
  [/^(стол$|стола$|столом$|столы$|столик)/, "table"],
  [/^(телевизор)/, "tv"],
  [/^(ноутбук)/, "laptop"],
  [/^(телефон|смартфон|мобильник)/, "phone"],
  [/^(книг|книжк)/, "book"],
  [/^(час(ы|ов)$)/, "clock"],
  [/^(ваз)/, "vase"],
  [/^(игрушк|мишк|медвежон)/, "toy"],
  [/^(провод|проводов)/, "power lines"],
  [/^(столб)/, "pole"],
  [/^(фонар)/, "street lamp"],
  [/^(мусор)/, "trash"],
  [/^(урн)/, "trash can"],
  [/^(дерев|ёлк|елк|куст)/, "tree"],
  [/^(ветк)/, "branch"],
  [/^(облак|туч)/, "cloud"],
  [/^(шапк|кепк|шляп)/, "hat"],
  [/^(очк)/, "glasses"],
  [/^(забор|ограждени)/, "fence"],
  [/^(вывеск|табличк|знак)/, "sign"],
  [/^(надпис|текст)/, "text"],
  [/^(здани|дом$|дома$|домик)/, "building"],
];

// «машину» → "car"; «красную машину» → "car"; латиница — как есть; иначе null (тогда переводит облако)
export function targetToEnglish(text) {
  const t = String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length > 60) return null;
  if (/^[a-z][a-z\s-]{0,40}$/.test(t)) return t;
  for (const w of t.split(" ")) {
    for (const [re, en] of TARGETS) if (re.test(w)) return en;
  }
  return null;
}

// ─── Ответ облака (уже проверенный zod на сервере) → шаги редактора ───
// Те же виды шагов, что у словаря на устройстве (lib/photo/commands.js): редактор применяет их одинаково.
const ADJUST_RU = { exposure: "Яркость", contrast: "Контраст", warmth: "Тепло", saturation: "Насыщенность", highlights: "Светлые", shadows: "Тени" };
export const ADJUST_KEYS_CLOUD = Object.keys(ADJUST_RU);

const signed = (v) => (v > 0 ? "+" + v : String(v));

export function opsToSteps(ops) {
  const steps = [];
  for (const o of ops || []) {
    switch (o?.op) {
      case "adjust": {
        const deltas = {};
        for (const k of ADJUST_KEYS_CLOUD) if (Number.isFinite(o[k]) && o[k] !== 0) deltas[k] = Math.max(-60, Math.min(60, Math.round(o[k])));
        if (Object.keys(deltas).length)
          steps.push({ kind: "adjust", deltas, say: Object.entries(deltas).map(([k, v]) => `${ADJUST_RU[k]} ${signed(v)}`).join(", "), f: 1 });
        break;
      }
      case "auto":
        steps.push({ kind: "auto", say: "Улучшили автоматически" });
        break;
      case "blur_background":
        steps.push({ kind: "blurBackground", say: "Размыть фон" });
        break;
      case "lighten_selection":
        steps.push({ kind: "maskTone", dir: 1, say: "Осветлить выделенное" });
        break;
      case "darken_selection":
        steps.push({ kind: "maskTone", dir: -1, say: "Затемнить выделенное" });
        break;
      case "remove":
        if (/^(sun|the sun|sunlight)$/.test(o.target)) steps.push({ kind: "remove", target: "sun", say: "Убрать солнце" });
        else if (/^(glare|reflection|lens flare|flare)s?$/.test(o.target)) steps.push({ kind: "remove", target: "glare", say: "Убрать блики" });
        else steps.push({ kind: "remove", target: o.target, en: o.target, say: "Убрать: " + o.target });
        break;
      case "find":
        steps.push({ kind: "find", target: o.target, en: o.target, say: "Найти: " + o.target });
        break;
      case "creative":
        steps.push({ kind: "creative", prompt: o.prompt, en: true, say: "Творческая правка" });
        break;
      case "undo":
        steps.push({ kind: "undo", say: "Отменили последний шаг" });
        break;
      case "reset":
        steps.push({ kind: "reset", say: "Вернули оригинал" });
        break;
      default:
        break;
    }
  }
  return steps;
}

// ─── Рамки поиска: { x0, y0, x1, y1 } в долях 0…1 ───

// Маска SlimSAM (0/1, w×h) → только внутри рамки с запасом pad (доля стороны рамки). Возвращает новую маску.
export function clipMaskToBox(bits, w, h, box, pad = 0.08) {
  const bw = box.x1 - box.x0;
  const bh = box.y1 - box.y0;
  const x0 = Math.max(0, Math.floor((box.x0 - bw * pad) * w));
  const x1 = Math.min(w, Math.ceil((box.x1 + bw * pad) * w));
  const y0 = Math.max(0, Math.floor((box.y0 - bh * pad) * h));
  const y1 = Math.min(h, Math.ceil((box.y1 + bh * pad) * h));
  const out = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) {
    const row = y * w;
    for (let x = x0; x < x1; x++) out[row + x] = bits[row + x] ? 1 : 0;
  }
  return out;
}

// Объединение масок одного размера
export function unionMasks(a, b) {
  if (!a) return b;
  if (!b) return a;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

// Точки-подсказки для SlimSAM по рамке: центр рамки («это предмет»)
export function boxPoint(box, w, h) {
  return { x: ((box.x0 + box.x1) / 2) * w, y: ((box.y0 + box.y1) / 2) * h, add: true };
}

// Размер ответа FLUX: стороны кратны 16, от 256 до 512, пропорции как у вырезки
export function outSize(w, h) {
  const k = 512 / Math.max(w, h);
  const fit = (v) => Math.max(256, Math.min(512, Math.round((v * k) / 16) * 16));
  return { width: fit(w), height: fit(h) };
}
