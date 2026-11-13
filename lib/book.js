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

// Управляющие и невидимые символы (в том числе смена направления текста) — заменяем пробелом
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]", "g");

// Текст с обложки: без управляющих символов и лишних пробелов, не длиннее max
export function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(CONTROL, " ").replace(/\s+/g, " ").trimStart())
    .slice(0, max)
    .join("");
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
