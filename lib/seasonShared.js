// Сезоны оформления (N2): общие константы для сервера и браузера. Без React.
// Договор для N2, N8, N11 — docs/night/night2-seasons.md: значения, палитры, пары текста с контрастом AA.
// Меняются только сезонные элементы (баннер, промо-плашка, линейная графика, цвет логотипа);
// кнопки, текст и фон интерфейса остаются фирменными. «none» — сезонных элементов нет.

export const SEASONS = ["none", "autumn", "blackfriday", "newyear"];
export const SEASON_DEFAULT = "none";

export const SEASON_LABELS = {
  none: "Без сезона",
  autumn: "Осень",
  blackfriday: "Чёрная пятница",
  newyear: "Новый год",
};

// Палитры — точно по таблице договора (токены --season-* в app/season.css)
export const SEASON_PALETTES = {
  autumn: { bg: "#F6EBDD", ink: "#3A2A22", 1: "#C98A2E", 2: "#B95C3A", 3: "#7A2833", 4: "#2F4A3F", 5: "#E2A84B" },
  blackfriday: { bg: "#1C1F1E", ink: "#F6EFE6", 1: "#DD5757", 2: "#E8996C", 3: "#AEB4B3", 4: "#FFFFFF", 5: "#38524F" },
  newyear: { bg: "#24443B", ink: "#FFFFFF", 1: "#D6A84A", 2: "#CFDDE7", 3: "#BD3434", 4: "#FAF7F7", 5: "#7AA45A" },
};

// Сезонный вариант логотипа: та же форма, цвет сезона (брендбук разрешает). Свой цвет для светлой и тёмной темы шапки.
export const SEASON_LOGO = {
  autumn: { light: "#B95C3A", dark: "#E2A84B" },
  blackfriday: { light: "#1C1F1E", dark: "#F6EFE6" },
  newyear: { light: "#24443B", dark: "#D6A84A" },
};

// Значение из базы, cookie или ответа API → сезон; всё неизвестное — «Без сезона»
export function parseSeason(value) {
  return SEASONS.includes(value) ? value : SEASON_DEFAULT;
}

// Контраст двух цветов по WCAG 2.x (для тестов и подсказок админке)
function channel(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
