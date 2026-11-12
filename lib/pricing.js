// Формулы цены, скидки, доставки и сроков. Одни и те же на сервере и в интерфейсе.
// Все деньги — целые копейки (BYN). Формулы описаны в README («Формулы») и в supabase/migrations/0002.
// Файл без зависимостей: его проверяют unit-тесты (npm run test:unit).

export const CURRENCY = "BYN";
export const TIMEZONE = "Europe/Minsk";

// Тестовый коэффициент размера книги от площади страницы: 20×20 → 1
export function sizeK(widthCm, heightCm) {
  return Math.round((1 + 0.6 * ((widthCm * heightCm) / 400 - 1)) * 1000) / 1000;
}

// Округление до 10 копеек (0,10 руб.)
export function roundTo10(kop) {
  return Math.round(kop / 10) * 10;
}

// Цена одной книги, коп.: (база + надбавка × (страниц − мин) / 2) × k, округлено до 0,10
export function bookUnitKop({ basePriceKop, per2PagesKop, minPages }, pages, k = 1) {
  const raw = basePriceKop + (per2PagesKop * (pages - minPages)) / 2;
  const kMilli = Math.round(Number(k) * 1000);
  return roundTo10((raw * kMilli) / 1000);
}

// Проверка числа страниц: в диапазоне продукта и с шагом 2 от минимума
export function pagesValid(product, pages) {
  return (
    Number.isInteger(pages) &&
    pages >= product.minPages &&
    pages <= product.maxPages &&
    (pages - product.minPages) % (product.pageStep || 2) === 0
  );
}

// Надбавка за выбранные опции, коп. (обложка, ламинация, бумага, печать, поверхность).
// В каталоге сейчас все надбавки 0 — опции на сайте цену не меняют; поле оставлено для админки.
export function optionsDeltaKop(product, options = {}) {
  let delta = 0;
  for (const [group, list] of Object.entries(product.options || {})) {
    const picked = list.find((x) => x.id === options[group]);
    if (picked?.priceDeltaKop) delta += picked.priceDeltaKop;
  }
  return delta;
}

// Цена строки корзины: { unitKop, count, lineKop }.
// Книга: (цена книги + надбавка опций) × количество. Фото: (цена отпечатка + надбавка опций) × число фото × количество комплектов.
export function linePrice(product, { sizeCode, pages, photoCount = 0, quantity = 1, options = {} }) {
  const size = product.sizes.find((s) => s.code === sizeCode);
  if (!size) return null;
  const delta = optionsDeltaKop(product, options);
  if (product.kind === "book") {
    if (!pagesValid(product, pages)) return null;
    const unitKop = bookUnitKop(product, pages, size.k) + delta;
    return { unitKop, count: 1, lineKop: unitKop * quantity };
  }
  const count = Math.max(1, photoCount);
  const unitKop = (size.unitPriceKop + delta) * count;
  return { unitKop, count, lineKop: unitKop * quantity };
}

// Промокод. now — время проверки. Возвращает { ok, code, reason, discountKop, freeDelivery, message }
export function applyPromo(promo, goodsKop, now = new Date()) {
  if (!promo || !promo.active) return { ok: false, reason: "not_found", message: "Не подходит: такого промокода нет." };
  const t = now.getTime();
  if (promo.validFrom && t < new Date(promo.validFrom).getTime()) {
    return { ok: false, reason: "not_started", message: "Не подходит: промокод ещё не действует." };
  }
  if (promo.validTo && t > new Date(promo.validTo).getTime()) {
    return { ok: false, reason: "expired", message: "Истёк: срок действия промокода закончился." };
  }
  if (goodsKop < (promo.minTotalKop || 0)) {
    return {
      ok: false,
      reason: "min_total",
      message: `Не подходит: промокод действует при заказе от ${formatByn(promo.minTotalKop)}.`,
    };
  }
  let discountKop = 0;
  if (promo.kind === "percent") discountKop = Math.round((goodsKop * promo.value) / 100);
  if (promo.kind === "amount") discountKop = Math.min(promo.value, goodsKop);
  return {
    ok: true,
    code: promo.code,
    kind: promo.kind,
    label: promo.label || "",
    discountKop,
    freeDelivery: promo.kind === "free_delivery",
    message: "Промокод применён",
  };
}

// Доставка, коп.: бесплатно по промокоду или если сумма после скидки ≥ порога способа
export function deliveryKop(method, afterDiscountKop, freeByPromo = false) {
  if (!method) return 0;
  if (freeByPromo) return 0;
  if (method.freeFromKop != null && afterDiscountKop >= method.freeFromKop) return 0;
  return method.priceKop;
}

// Итог заказа: товары → скидка промокода → доставка → итого
export function calcTotals({ lines, method, promo, now = new Date() }) {
  const goodsKop = lines.reduce((s, l) => s + l.lineKop, 0);
  const promoResult = promo ? applyPromo(promo, goodsKop, now) : null;
  const discountKop = promoResult?.ok ? promoResult.discountKop : 0;
  const afterDiscountKop = goodsKop - discountKop;
  const delivery = deliveryKop(method, afterDiscountKop, !!promoResult?.ok && promoResult.freeDelivery);
  return {
    currency: CURRENCY,
    goodsKop,
    discountKop,
    deliveryKop: delivery,
    freeDelivery: !!method && delivery === 0,
    totalKop: afterDiscountKop + delivery,
    promo: promoResult,
  };
}

// Календарная дата по Минску (YYYY-MM-DD)
export function minskDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// Ориентировочный срок: сегодня по Минску + срок печати + дни доставки (от и до)
export function etaRange(now, printDays, minDays, maxDays) {
  const today = minskDate(now);
  return { from: addDays(today, printDays + minDays), to: addDays(today, printDays + maxDays) };
}

// Начало дня по Минску (UTC+3, без перехода на летнее время) в виде timestamptz
export function minskDayStart(ymd) {
  return `${ymd}T00:00:00+03:00`;
}

export function kopToByn(kop) {
  return Math.round(kop) / 100;
}

// 14100 → «141,00 BYN» (как в корзине и заказах)
export function formatByn(kop) {
  return (kop / 100).toFixed(2).replace(".", ",") + " BYN";
}

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

// «2026-11-15», «2026-11-16» → «15–16 ноября»; разные месяцы → «30 ноября – 1 декабря»
export function formatEtaRange(from, to) {
  const [, m1, d1] = from.split("-").map(Number);
  const [, m2, d2] = to.split("-").map(Number);
  if (from === to) return `${d1} ${MONTHS_GEN[m1 - 1]}`;
  if (m1 === m2) return `${d1}–${d2} ${MONTHS_GEN[m2 - 1]}`;
  return `${d1} ${MONTHS_GEN[m1 - 1]} – ${d2} ${MONTHS_GEN[m2 - 1]}`;
}

// Срок по Минску от календарной даты (YYYY-MM-DD): печать + доставка способа
export function etaFromDay(ymd, printDays, minDays, maxDays) {
  return { from: addDays(ymd, printDays + minDays), to: addDays(ymd, printDays + maxDays) };
}

// «3 дня», «5 дней», «1 день»
export function daysWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return `${n} дней`;
  if (b === 1) return `${n} день`;
  if (b >= 2 && b <= 4) return `${n} дня`;
  return `${n} дней`;
}
