// SEC-14: маскировка персональных данных клиента для модератора и оператора. Чистые функции (unit-тесты).

const DOT = "•";

// «Тест Тестович» → «Тест Т.»
export function maskName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return [parts[0], ...parts.slice(1).map((p) => p[0].toUpperCase() + ".")].join(" ");
}

// «Тест Тестович» → «Т. Т.»
export function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return parts.map((p) => p[0].toUpperCase() + ".").join(" ");
}

// «+375 (29) 123-45-67» → «+375 ••• •• 67»: видны только код страны и 2 последние цифры
export function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length < 4) return digits ? DOT.repeat(digits.length) : "";
  const country = digits.startsWith("375") ? "+375 " : "";
  const rest = country ? digits.slice(3) : digits;
  return country + DOT.repeat(Math.max(0, rest.length - 2)) + " " + rest.slice(-2);
}

// «ivan@example.com» → «i•••@example.com»
export function maskEmail(email) {
  const s = String(email || "");
  const at = s.indexOf("@");
  if (at < 1) return s ? DOT.repeat(3) : "";
  return s[0] + DOT.repeat(3) + s.slice(at);
}

// Адрес доставки: только город (или «пункт выдачи»), без улицы, дома и квартиры
export function maskAddress(address) {
  const a = address || {};
  if (a.city) return `г. ${String(a.city).slice(0, 40)}`;
  if (a.pickup_point) return "Пункт выдачи (скрыт)";
  return "";
}

// Клиент для оператора (админа) и модератора. Модератор видит только инициалы, без адреса.
export function maskClient(order, role = "admin") {
  const r = order?.recipient || {};
  if (role === "moderator") return { name: initials(r.name), phone: maskPhone(r.phone), email: maskEmail(r.email) };
  return { name: maskName(r.name), phone: maskPhone(r.phone), email: maskEmail(r.email), address: maskAddress(order?.delivery_address) };
}
