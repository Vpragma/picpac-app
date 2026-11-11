// Оформление заказа: проверка полей формы и тестовые справочники. Без зависимостей — проверяют unit-тесты.

// Тестовый список пунктов выдачи Европочты (выдуманные адреса, только для демо)
export const PICKUP_POINTS = [
  "Минск, ПВЗ № 101 — ул. Тестовая, 1",
  "Минск, ПВЗ № 102 — пр-т Примерный, 25",
  "Минск, ПВЗ № 103 — ул. Демонстрационная, 7",
  "Брест, ПВЗ № 201 — ул. Учебная, 3",
  "Гомель, ПВЗ № 301 — ул. Образцовая, 12",
  "Гродно, ПВЗ № 401 — ул. Пробная, 5",
  "Витебск, ПВЗ № 501 — ул. Макетная, 9",
  "Могилёв, ПВЗ № 601 — ул. Эскизная, 14",
];

// Ввод телефона → «+375 (29) 123-45-67». Принимает и «8029…», и «29…».
export function formatPhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.startsWith("80")) d = "375" + d.slice(2);
  else if (d && !d.startsWith("375")) d = "375" + d;
  d = d.slice(0, 12);
  if (!d) return "";
  let out = "+" + d.slice(0, 3);
  if (d.length > 3) out += " (" + d.slice(3, 5);
  if (d.length >= 5) out += ")";
  if (d.length > 5) out += " " + d.slice(5, 8);
  if (d.length > 8) out += "-" + d.slice(8, 10);
  if (d.length > 10) out += "-" + d.slice(10, 12);
  return out;
}

export function phoneValid(phone) {
  return /^\+375 \((17|25|29|33|44|1[5-6]|2[1-3])\) \d{3}-\d{2}-\d{2}$/.test(String(phone || ""));
}

export const FIELD_LABELS = {
  city: "Город",
  street: "Улица",
  house: "Дом",
  flat: "Квартира",
  postcode: "Индекс",
  pickup_point: "Пункт выдачи",
};

// Курьер приезжает в выбранный день
export const needsDate = (method) => !!method && method.code.startsWith("courier");

// Ошибки формы: { поле: "что исправить" }. Пустой объект — всё верно.
// form: { name, phone, email, delivery, address: {…}, date, payment }; minDate — самая ранняя дата доставки (YYYY-MM-DD)
export function validateCheckout(form, method, minDate) {
  const e = {};
  const name = String(form.name || "").trim();
  if (name.length < 2) e.name = "Введите имя и фамилию получателя.";
  if (!phoneValid(form.phone)) e.phone = "Телефон в формате +375 (29) 123-45-67.";
  const email = String(form.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) e.email = "Почта в формате name@example.com.";
  if (!method) {
    e.delivery = "Выберите способ получения.";
    return e;
  }
  const a = form.address || {};
  for (const f of method.addressFields || []) {
    const v = String(a[f] || "").trim();
    if (!v) e[f] = f === "pickup_point" ? "Выберите пункт выдачи из списка." : `Укажите: ${FIELD_LABELS[f]?.toLowerCase() || f}.`;
    else if (f === "postcode" && !/^\d{6}$/.test(v)) e[f] = "Индекс — 6 цифр, например 220030.";
  }
  if (needsDate(method)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.date || ""))) e.date = "Выберите дату доставки.";
    else if (minDate && form.date < minDate) e.date = "Так быстро не успеем: выберите дату не раньше " + minDate.split("-").reverse().join(".") + ".";
  }
  if (!["card_test", "erip_test"].includes(form.payment)) e.payment = "Выберите тестовую оплату.";
  return e;
}
