// Оформление фотокниги (N11): шаблоны страниц и обложка. Общий модуль для браузера и сервера, без React.
// Хранение без миграции: на устройстве — project.book, в аккаунте — options.settings.book (lib/sync.js),
// в заказе — order_items.options.settings.book и снимок order_items.snapshot.book (app/api/v1/orders/route.js).
// Поля и зазоры шаблона — доли страницы, их учитывает автомакет (lib/layout.js → autoLayout).

export const BOOK_TEMPLATES = [
  { id: "classic", name: "Классика", hint: "белая бумага, ничего лишнего", margin: 0.06, gap: 0.03 },
  { id: "autumn", name: "Осень", hint: "тёплый фон и кленовые листья", margin: 0.1, gap: 0.035 },
  { id: "wedding", name: "Свадьба", hint: "светлые поля и тонкие рамки", margin: 0.11, gap: 0.04 },
  { id: "baby", name: "Малыш", hint: "нежный фон и мягкие углы", margin: 0.09, gap: 0.04 },
  { id: "travel", name: "Путешествие", hint: "фото-карточки и маршрут", margin: 0.09, gap: 0.05 },
];
export const DEFAULT_TEMPLATE = "classic";

export const COVER_LAYOUTS = [
  { id: "photo", name: "Фото и подпись" },
  { id: "full", name: "Фото на всю обложку" },
  { id: "title", name: "Только название" },
];
export const DEFAULT_COVER_LAYOUT = "photo";

export const TITLE_MAX = 40;
export const DATE_MAX = 24;

const byId = Object.fromEntries(BOOK_TEMPLATES.map((t) => [t.id, t]));
const coverById = Object.fromEntries(COVER_LAYOUTS.map((c) => [c.id, c]));

export function bookTemplate(id) {
  return byId[id] || byId[DEFAULT_TEMPLATE];
}

// Управляющие и невидимые символы (в том числе смена направления текста) — заменяем пробелом.
// U+200C и U+200D (ZWNJ, ZWJ) оставляем: из них собраны эмодзи-последовательности (👨‍👩‍👧) и знаки письменностей.
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b\\u200e\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]", "g");
// Знаки, которые продолжают предыдущий символ (для запасного разбиения без Intl.Segmenter)
const JOINS = /^(?:\u200d|[\u0300-\u036f\ufe00-\ufe0f]|\ud83c[\udffb-\udfff]|\udb40[\udc20-\udc7f])$/;

let segmenter;
// Текст → графемы (то, что человек видит как один знак: 👨‍👩‍👧, 🇧🇾, «й»). Одинаково на устройстве и на сервере.
export function graphemes(text) {
  if (typeof text !== "string" || !text) return [];
  if (segmenter === undefined) segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter("ru", { granularity: "grapheme" }) : null;
  if (segmenter) return Array.from(segmenter.segment(text), (x) => x.segment);
  const out = [];
  for (const ch of Array.from(text)) {
    const prev = out.length ? out[out.length - 1] : "";
    if (prev && (JOINS.test(ch) || prev.endsWith("\u200d"))) out[out.length - 1] = prev + ch;
    else out.push(ch);
  }
  return out;
}

// Длина в знаках, которые видит человек (счётчик «N из 40» и проверка на сервере)
export function textLength(text) {
  return graphemes(text).length;
}

// Текст с обложки: без управляющих символов и лишних пробелов, не длиннее max знаков (графем)
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  // очень длинную вставку сначала укорачиваем грубо (графема — не больше 32 единиц UTF-16)
  const s = value.slice(0, max * 32).replace(CONTROL, " ").replace(/\s+/g, " ").trimStart();
  return graphemes(s).slice(0, max).join("");
}

// Любые данные (с устройства, из аккаунта, из запроса) → { template, cover: { title, date, layout } }
export function normBook(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  const c = b.cover && typeof b.cover === "object" ? b.cover : {};
  return {
    template: byId[b.template] ? b.template : DEFAULT_TEMPLATE,
    cover: {
      title: cleanText(c.title, TITLE_MAX).trim(),
      date: cleanText(c.date, DATE_MAX).trim(),
      layout: coverById[c.layout] ? c.layout : DEFAULT_COVER_LAYOUT,
    },
  };
}

// Пока клиент печатает, пробел в конце не срезаем — иначе в поле нельзя ввести второе слово
export function draftCoverText(value, max) {
  return cleanText(value, max);
}

// Шаблоны в порядке показа: в сезон «Осень» осенний шаблон — первым
export function templatesInOrder(season) {
  if (season !== "autumn") return BOOK_TEMPLATES;
  return [byId.autumn, ...BOOK_TEMPLATES.filter((t) => t.id !== "autumn")];
}

// Новый проект книги: в сезон «Осень» сразу предлагаем осенний шаблон (клиент может выбрать другой — выбор сохранится)
export function initialBook(season) {
  return season === "autumn" ? { template: "autumn", cover: { title: "", date: "", layout: DEFAULT_COVER_LAYOUT } } : null;
}

// Для автомакета: поля и зазор выбранного шаблона
export function layoutOptions(book) {
  const t = bookTemplate(book?.template);
  return { margin: t.margin, gap: t.gap };
}

// Настройки проекта в аккаунте (options.settings.book) ⇄ проект на устройстве (project.book)
export function bookToSettings(book) {
  return book ? normBook(book) : undefined;
}
export function bookFromSettings(settings) {
  return settings?.book ? normBook(settings.book) : undefined;
}

// Снимок оформления для заказа: производство получает шаблон (с полями и зазором автомакета) и обложку.
// У проектов без выбора — «Классика» и обложка «Фото и подпись» без текста (как в превью).
export function bookForOrder(options) {
  const b = normBook(options?.settings?.book);
  const t = bookTemplate(b.template);
  return {
    template: t.id,
    templateName: t.name,
    margin: t.margin,
    gap: t.gap,
    cover: { ...b.cover, layoutName: coverById[b.cover.layout].name },
  };
}

// Строка для экранов заказа (клиент и производство): «Оформление «Осень» · обложка «Только название»: «Лето», 2026»
export function bookSummary(snap) {
  if (!snap || typeof snap !== "object") return "";
  const t = bookTemplate(snap.template);
  const c = snap.cover && typeof snap.cover === "object" ? snap.cover : {};
  const layout = coverById[c.layout]?.name || coverById[DEFAULT_COVER_LAYOUT].name;
  const title = cleanText(c.title, TITLE_MAX).trim();
  const date = cleanText(c.date, DATE_MAX).trim();
  const text = [title && `«${title}»`, date].filter(Boolean).join(", ");
  return `Оформление «${t.name}» · обложка «${layout}»${text ? ": " + text : ""}`;
}
