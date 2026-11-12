// Склонение после числа: plural(1, ["точка", "точки", "точек"]) или plural(1, "точка", "точки", "точек") → «точка»;
// 2–4, 22–24… → «точки»; 0, 5–20, 11–14, 25… → «точек». Две формы вызова — из дорожек UI (массив) и ED (аргументы).
export function plural(n, ...forms) {
  const [one, few, many] = Array.isArray(forms[0]) ? forms[0] : forms;
  const a = Math.abs(Math.trunc(Number(n) || 0));
  const d = a % 10;
  const dd = a % 100;
  if (dd > 10 && dd < 20) return many;
  if (d === 1) return one;
  if (d >= 2 && d <= 4) return few;
  return many;
}

// «102 точки на дюйм»
export const dpiText = (dpi) => `${dpi} ${plural(dpi, "точка", "точки", "точек")} на дюйм`;
