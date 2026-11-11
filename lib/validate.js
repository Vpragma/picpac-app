// Проверка того, что ввёл человек. Сервер проверяет всегда, экран — только для подсказок.

export const PASSWORD_MIN = 8;
export const NAME_MAX = 100;

// Почта: без пробелов, с @ и точкой в домене. Возвращает почту в нижнем регистре или null.
export function normEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s || s.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

// Имя: убираем служебные символы и лишние пробелы, длина от 1 до 100.
export function normName(value) {
  const s = String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 1 && s.length <= NAME_MAX ? s : null;
}

// Пароль: от 8 символов. Сверху — 72 байта: больше Supabase не принимает.
export function passwordProblem(value) {
  if (typeof value !== "string" || value.length < PASSWORD_MIN) return `Пароль должен быть не короче ${PASSWORD_MIN} символов.`;
  if (new TextEncoder().encode(value).length > 72) return "Пароль слишком длинный: не больше 72 латинских или 36 русских букв.";
  return null;
}

// Адрес возврата после входа: только страница этого же сайта, иначе fallback.
export function safeNext(value, fallback = "/") {
  const s = String(value ?? "");
  if (!s.startsWith("/") || s.startsWith("//") || s.length > 300) return fallback;
  if (/[\\\u0000-\u001f\u007f\s]/.test(s)) return fallback;
  try {
    const u = new URL(s, "http://picpac.local");
    if (u.origin !== "http://picpac.local") return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
