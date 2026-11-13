// Полоса «до бесплатной доставки» в корзине (день 3, задача 1).
// Пороги — только из каталога доставки (freeFromKop у способа). «Бесплатно или нет» решает та же deliveryKop(),
// что считает строку «Доставка» в итоге: сумма товаров после скидки промокода, код с бесплатной доставкой —
// бесплатно при любой сумме. Поэтому полоса и строка «Доставка» не могут разойтись.
import { deliveryKop } from "./pricing.js";

// Творительный падеж для текста («доставки Белпочтой»); EMS не склоняется
const INSTRUMENTAL = { belpost: "Белпочтой", europost: "Европочтой" };
const byName = (m) => INSTRUMENTAL[m.code] || m.name;

// methods — способы доставки из каталога, afterDiscountKop — сумма товаров после скидки (коп.).
// → null (нет способов с порогом) | { state: "first" | "next" | "done" | "promo", method, freeMethod, leftKop, fill 0…1 }
export function freeDeliveryProgress(methods, afterDiscountKop, freeByPromo = false) {
  const steps = (methods || []).filter((m) => m.freeFromKop != null && m.freeFromKop > 0).sort((a, b) => a.freeFromKop - b.freeFromKop);
  if (!steps.length) return null;
  if (freeByPromo) return { state: "promo", method: null, freeMethod: null, leftKop: 0, fill: 1 };
  const sum = Math.max(0, afterDiscountKop || 0);
  const i = steps.findIndex((m) => deliveryKop(m, sum) !== 0);
  if (i === -1) return { state: "done", method: steps[steps.length - 1], freeMethod: null, leftKop: 0, fill: 1 };
  const method = steps[i];
  return { state: i === 0 ? "first" : "next", method, freeMethod: i > 0 ? steps[i - 1] : null, leftKop: method.freeFromKop - sum, fill: sum / method.freeFromKop };
}

// Текст полосы: before + сумма (экран выделяет её цветом); ok — доставка уже бесплатна
export function freeDeliveryMessage(p, promoCode = "") {
  if (!p) return null;
  if (p.state === "promo") return { ok: true, before: `Доставка бесплатна по промокоду${promoCode ? " " + promoCode : ""}`, amountKop: null };
  if (p.state === "done") return { ok: true, before: `Доставка ${byName(p.method)} бесплатна`, amountKop: null };
  if (p.state === "first") return { ok: false, before: `До бесплатной доставки ${byName(p.method)} осталось `, amountKop: p.leftKop };
  return { ok: false, before: `Доставка ${byName(p.freeMethod)} бесплатна. До бесплатной ${byName(p.method)} осталось `, amountKop: p.leftKop };
}
