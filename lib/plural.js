// Склонение после числа: plural(1, "точка", "точки", "точек") → «точка»; 2–4 → «точки»; 5–20, 11–14 → «точек».
export function plural(n, one, few, many) {
  const a = Math.abs(Math.trunc(Number(n) || 0));
  const d = a % 10;
  const dd = a % 100;
  if (d === 1 && dd !== 11) return one;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return few;
  return many;
}

// «102 точки на дюйм»
export const dpiText = (dpi) => `${dpi} ${plural(dpi, "точка", "точки", "точек")} на дюйм`;
