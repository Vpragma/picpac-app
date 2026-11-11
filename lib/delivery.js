// Тестовые способы доставки — из superpicpac.md (цены с picpac.by).
import { round2 } from "./price";

export const DELIVERY = [
  { id: "europost", name: "Европочта", note: "в пункт выдачи", price: 5.9, freeFrom: null, eta: "от 2 дней" },
  { id: "belpost", name: "Белпочта", note: "в почтовое отделение", price: 6.9, freeFrom: 150, eta: "от 2 дней" },
  { id: "ems", name: "EMS", note: "курьер по Беларуси", price: 20.9, freeFrom: 300, eta: "1–2 дня" },
  { id: "courier-minsk", name: "Курьер Европочты по Минску", note: "до двери", price: 14.9, freeFrom: null, eta: "на выбранную дату" },
];

// Тестовые промокоды
export const PROMOS = { TEST10: { code: "TEST10", percent: 10, label: "−10% на заказ" } };

export function findPromo(code) {
  return PROMOS[String(code || "").trim().toUpperCase()] || null;
}

// Порог бесплатной доставки считаем от суммы товаров со скидкой.
export function calcTotals(items, deliveryId, promo) {
  const goods = round2(items.reduce((s, i) => s + i.price, 0));
  const discount = promo ? round2((goods * promo.percent) / 100) : 0;
  const afterDiscount = round2(goods - discount);
  const d = DELIVERY.find((x) => x.id === deliveryId) || DELIVERY[0];
  const free = d.freeFrom != null && afterDiscount >= d.freeFrom;
  const delivery = free ? 0 : d.price;
  return { goods, discount, delivery, freeDelivery: free, total: round2(afterDiscount + delivery) };
}
