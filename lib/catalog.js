// Каталог PicPac. Все цифры — из docs/superpicpac/superpicpac.md (снято 11.11.2026).
// Цены фотокниг на сайте видны только для 20×20 см.
// TODO: уточнить у организаторов цены других размеров — пока считаем как для 20×20.

export const CATALOG_VERSION = "2026-11-11";

export const products = [
  {
    slug: "pages-book",
    name: "Lite",
    kind: "book",
    tagline: "Альбом за год, детские рисунки, фото с телефона",
    description: "Тонкая гладкая бумага без плёнки, листается как журнал. Обложка твёрдая, с вашим фото, глянцевая.",
    sizes: [
      { id: "20x20", label: "Квадрат", w: 20, h: 20 },
      { id: "26x26", label: "Большой квадрат", w: 26, h: 26 },
      { id: "21x30", label: "Как лист А4", w: 21, h: 30 },
    ],
    covers: [{ id: "gloss", label: "Глянцевая", note: "Твёрдая, с вашим фото" }],
    pages: { min: 24, max: 160, step: 2 },
    photos: { min: 24, max: 480 },
    price: { currency: "BYN", base: 70.0, per2Pages: 2.0, basedOnSize: "20x20" },
    printDays: 3,
  },
  {
    slug: "layflat",
    name: "Classic",
    kind: "book",
    badge: "выбор pic pac",
    tagline: "Семейный альбом, путешествие, выпускной",
    description: "Плотные страницы под ламинацией, раскрытие на 180° без шва.",
    sizes: [
      { id: "20x20", label: "Квадрат", w: 20, h: 20 },
      { id: "21x30", label: "Как лист А4", w: 21, h: 30 },
    ],
    covers: [
      { id: "gloss", label: "Глянцевая", note: "Яркая, с блеском" },
      { id: "matte", label: "Матовая", note: "Без бликов" },
    ],
    pages: { min: 20, max: 60, step: 2 },
    photos: { min: 20, max: 180 },
    price: { currency: "BYN", base: 81.0, per2Pages: 3.0, basedOnSize: "20x20" },
    printDays: 3,
  },
  {
    slug: "photopaper-book",
    name: "Premium",
    kind: "book",
    tagline: "Свадьба, юбилей, подарок к большой дате",
    description: "Матовая фотобумага, наклеенная на картон. Обложка твёрдая, глянцевая.",
    sizes: [
      { id: "20x20", label: "Квадрат", w: 20, h: 20 },
      { id: "30x20", label: "Альбомный", w: 30, h: 20 },
      { id: "25x25", label: "Большой квадрат", w: 25, h: 25 },
      { id: "30x30", label: "Самый большой", w: 30, h: 30 },
      { id: "21x30", label: "Как лист А4", w: 21, h: 30 },
    ],
    covers: [{ id: "gloss", label: "Глянцевая", note: "Твёрдая" }],
    pages: { min: 10, max: 60, step: 2 },
    photos: { min: 10, max: 180 },
    price: { currency: "BYN", base: 100.5, per2Pages: 7.0, basedOnSize: "20x20" },
    printDays: 3,
  },
  {
    slug: "photo",
    name: "Печать фото",
    kind: "print",
    tagline: "Фотохимическая печать на фотобумаге, как в фотоателье",
    description: "Заказ от 1 штуки. Края могут срезаться на несколько миллиметров. Много фото раскладываем по конвертам — приходят одной посылкой.",
    sizes: [
      { id: "10x15", label: "Обычное фото", w: 10, h: 15, unitPrice: 1.3 },
      { id: "15x20", label: "Чуть больше", w: 15, h: 20, unitPrice: 1.6 },
      { id: "20x30", label: "Почти как лист А4", w: 20, h: 30, unitPrice: 3.2 },
      { id: "30x45", label: "Постер", w: 30, h: 45, unitPrice: 20.0 },
    ],
    surfaces: [
      { id: "gloss", label: "Глянцевая", note: "Ярче, но видны отпечатки пальцев" },
      { id: "matte", label: "Матовая", note: "Без бликов и отпечатков" },
    ],
    price: { currency: "BYN", per: "photo" },
    printDays: 2,
  },
  {
    slug: "digital",
    name: "Цифровая печать",
    kind: "print",
    tagline: "Дешевле, цвета проще",
    description: "Цифровая печать фото. Заказ от 1 штуки.",
    // TODO: уточнить у организаторов цены цифровой печати других размеров.
    sizes: [{ id: "10x15", label: "Обычное фото", w: 10, h: 15, unitPrice: 0.61 }],
    surfaces: [
      { id: "gloss", label: "Глянцевая", note: "Ярче, но видны отпечатки пальцев" },
      { id: "matte", label: "Матовая", note: "Без бликов и отпечатков" },
    ],
    price: { currency: "BYN", per: "photo" },
    printDays: 2,
  },
];

export function findProduct(slug) {
  return products.find((p) => p.slug === slug);
}
