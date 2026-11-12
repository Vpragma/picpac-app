// N9: строка CSV для выгрузок админки. Чистая функция (unit-тест).
// Разделитель «;». Поле в кавычках, если в нём есть «;», кавычка или перенос строки.
// Защита от «формул» в Excel (CSV injection): текст, который начинается с = + - @ или табуляции, — с апострофом впереди.
export function csvCell(value) {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = "'" + s;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells) {
  return cells.map(csvCell).join(";");
}
