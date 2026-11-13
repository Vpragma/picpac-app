// «Нужно к дате» на странице товара (день 3, задача 2): какой способ доставки успеет к выбранной дате.
// Сроки способов — из нашего расчёта (etaFromDay: печать + дни способа), здесь их не пересчитываем.
// Сравниваем календарные даты по Минску строками YYYY-MM-DD, а не метки времени.
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const isYmd = (s) => typeof s === "string" && YMD.test(s);

// rows — [{ code, name, to }] в порядке каталога (to — последний день срока), needBy — дата из поля, today — сегодня по Минску.
// → null (дата не выбрана) | { invalid: true } (прошлое — iOS иногда пропускает min — или не дата)
//   | { invalid: false, fits: { code: true|false }, anyFits, earliest }: earliest — самый ранний последний день срока
//   среди всех способов (при равных сроках — первый по каталогу), только когда не успевает ни один.
export function needByCheck(rows, needBy, today) {
  if (!needBy) return null;
  if (!isYmd(needBy) || needBy < today) return { invalid: true, fits: {}, anyFits: false, earliest: null };
  const fits = {};
  let earliest = null;
  for (const r of rows) {
    fits[r.code] = r.to <= needBy;
    if (!earliest || r.to < earliest.to) earliest = r;
  }
  const anyFits = rows.some((r) => fits[r.code]);
  return { invalid: false, fits, anyFits, earliest: anyFits ? null : earliest };
}
