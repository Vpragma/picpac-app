// Тема оформления (N1): общие константы для сервера (app/layout.js) и браузера (lib/theme.js). Без React.
export const THEME_COOKIE = "pp_theme";
export const THEMES = ["light", "dark", "system"];
export const THEME_LABELS = { light: "Светлая", dark: "Тёмная", system: "Как в системе" };
// Цвет строки состояния телефона (meta theme-color) — фон страницы темы
export const THEME_COLORS = { light: "#faf5ed", dark: "#172321" };

// Значение cookie → тема; всё неизвестное и отсутствие cookie — светлая (светлая по умолчанию у всех)
export function parseTheme(value) {
  return THEMES.includes(value) ? value : "light";
}
