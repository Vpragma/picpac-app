// Оформление заказа: маска телефона и проверка полей формы (lib/checkout.js)
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatPhone, phoneValid, validateCheckout } from "../../lib/checkout.js";

test("телефон: маска +375 (XX) XXX-XX-XX из разных вариантов ввода", () => {
  assert.equal(formatPhone("291234567"), "+375 (29) 123-45-67");
  assert.equal(formatPhone("80291234567"), "+375 (29) 123-45-67");
  assert.equal(formatPhone("+375 29 123 45 67"), "+375 (29) 123-45-67");
  assert.equal(formatPhone("37529"), "+375 (29)");
  assert.ok(phoneValid("+375 (44) 765-43-21"));
  assert.ok(!phoneValid("+375 (29) 123-45"));
  assert.ok(!phoneValid("+7 (912) 123-45-67"));
});

const europost = { code: "europost", addressFields: ["pickup_point"] };
const belpost = { code: "belpost", addressFields: ["city", "street", "house", "postcode"] };
const courier = { code: "courier-minsk", addressFields: ["street", "house", "flat"] };
const ok = { name: "Тест Тестович", phone: "+375 (29) 123-45-67", email: "", payment: "card_test" };

test("форма: пустые поля и неверные значения дают понятные подсказки", () => {
  const e = validateCheckout({ name: "", phone: "123", email: "bad", payment: "" }, null);
  assert.match(e.name, /имя/);
  assert.match(e.phone, /\+375/);
  assert.match(e.email, /name@example\.com/);
  assert.match(e.delivery, /способ/);
});

test("форма: зависимые поля способа доставки", () => {
  assert.match(validateCheckout({ ...ok, address: {} }, europost).pickup_point, /пункт/);
  assert.deepEqual(validateCheckout({ ...ok, address: { pickup_point: "ПВЗ 1" } }, europost), {});
  const b = validateCheckout({ ...ok, address: { city: "Минск", street: "Тестовая", house: "1", postcode: "2200" } }, belpost);
  assert.match(b.postcode, /6 цифр/);
  const c = validateCheckout({ ...ok, address: { street: "Тестовая", house: "1", flat: "2" } }, courier, "2026-11-15");
  assert.match(c.date, /дату/);
  const c2 = validateCheckout({ ...ok, date: "2026-11-14", address: { street: "Тестовая", house: "1", flat: "2" } }, courier, "2026-11-15");
  assert.match(c2.date, /не раньше 15\.11\.2026/);
  assert.deepEqual(validateCheckout({ ...ok, date: "2026-11-16", address: { street: "Тестовая", house: "1", flat: "2" } }, courier, "2026-11-15"), {});
});
