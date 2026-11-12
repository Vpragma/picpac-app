// Склонение после числа: plural(1, ["точка", "точки", "точек"]) → «точка»; 3 → «точки»; 11 и 25 → «точек».
// forms — [для 1, 21, 31…; для 2–4, 22–24…; для 0, 5–20, 25…]
export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
