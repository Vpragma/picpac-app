// Формулы цены и сроков — один в один со справочником superpicpac.md.

// цена = базовая_цена + надбавка_за_2_страницы × (страниц − минимум_страниц) / 2
export function bookPrice(product, pages) {
  const { base, per2Pages } = product.price;
  const extra = (pages - product.pages.min) / 2;
  return round2(base + per2Pages * extra);
}

export function printPrice(product, sizeId, count) {
  const size = product.sizes.find((s) => s.id === sizeId) || product.sizes[0];
  return round2(size.unitPrice * count);
}

export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function money(n) {
  return n.toFixed(2).replace(".", ",") + " руб.";
}

// Ориентировочная доставка: срок печати + 1–2 дня.
export function deliveryRange(printDays, from = new Date()) {
  const a = new Date(from);
  a.setDate(a.getDate() + printDays + 1);
  const b = new Date(from);
  b.setDate(b.getDate() + printDays + 2);
  const fmt = (d, withMonth) =>
    d.toLocaleDateString("ru-RU", withMonth ? { day: "numeric", month: "long" } : { day: "numeric" });
  if (a.getMonth() === b.getMonth()) return `${fmt(a, false)}–${fmt(b, true)}`;
  return `${fmt(a, true)} – ${fmt(b, true)}`;
}

// Подсказка «поместится N–3N фото»
export function photoHint(pages) {
  return `поместится ${pages}–${pages * 3} фото · ориентир`;
}

// Наше правило «Подобрать по числу фото»: минимальное чётное число страниц,
// при котором фото ≤ 3 × страниц, в пределах диапазона продукта.
export function pagesForPhotos(product, photoCount) {
  let p = Math.ceil(photoCount / 3);
  if (p % 2) p += 1;
  return Math.min(product.pages.max, Math.max(product.pages.min, p));
}
