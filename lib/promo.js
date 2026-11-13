// Промокоды (N8): проверка условий и расчёт скидки. Одни и те же правила на сервере и в интерфейсе:
// экран корзины сразу пересчитывает скидку, а при оформлении сервер проверяет всё заново (в том числе лимиты
// и личные коды — их видит только сервер). Все деньги — целые копейки BYN. Файл без зависимостей (unit-тесты).

export const PROMO_RE = /^[A-Z0-9]{3,20}$/;
export const PROMO_KINDS = ["percent", "amount", "free_delivery"];
export const KIND_LABELS = { percent: "Процент", amount: "Сумма", free_delivery: "Бесплатная доставка" };
// Сезоны — договор с N2 (docs/night/night2-seasons.md)
export const SEASONS = ["autumn", "blackfriday", "newyear"];
export const SEASON_LABELS = { autumn: "Осень", blackfriday: "Чёрная пятница", newyear: "Новый год" };

// Личный код-открытка к каждому заказу: −10% на следующий заказ, 60 дней, один раз, только владельцу
export const CARD_TERMS = { kind: "percent", value: 10, days: 60, minTotalKop: 0 };

const TZ = "Europe/Minsk";
const byn = (kop) => (kop / 100).toFixed(2).replace(".", ",") + " BYN";

export function normalizeCode(code) {
  const c = String(code || "")
    .trim()
    .toUpperCase();
  return PROMO_RE.test(c) ? c : null;
}

// «30 ноября 2026» по Минску
export function promoDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(d).replace(/\s*г\.$/, "");
}

// Строка базы → объект промокода (owner — только на сервере, клиенту не отдаём)
export function shapePromo(row) {
  if (!row) return null;
  return {
    code: row.code,
    kind: row.kind,
    value: row.value,
    minTotalKop: row.min_total_kop || 0,
    validFrom: row.valid_from || null,
    validTo: row.valid_to || null,
    label: row.label || "",
    active: !!row.active,
    productSlugs: row.product_slugs || [],
    season: row.season || null,
    maxUses: row.max_uses ?? null,
    maxUsesPerUser: row.max_uses_per_user ?? null,
    ownerUserId: row.owner_user_id || null,
    sourceOrderId: row.source_order_id || null,
    personal: !!row.owner_user_id,
  };
}

// Что можно показать клиенту (без владельца и лимитов)
export function publicPromo(p) {
  if (!p) return null;
  return {
    code: p.code,
    kind: p.kind,
    value: p.value,
    minTotalKop: p.minTotalKop || 0,
    validFrom: p.validFrom,
    validTo: p.validTo,
    label: p.label,
    active: p.active,
    productSlugs: p.productSlugs || [],
    season: p.season || null,
    personal: !!p.personal,
  };
}

// «−15%», «−10,00 BYN», «бесплатная доставка»
export function benefitText(p) {
  if (!p) return "";
  if (p.kind === "percent") return `−${p.value}%`;
  if (p.kind === "amount") return `−${byn(p.value)}`;
  return "бесплатная доставка";
}

// Названия продуктов для сообщений: «фотокниги Lite, Classic, Premium», «Печать фото»
export function productsText(slugs = [], products = []) {
  const list = slugs.map((s) => products.find((p) => p.slug === s) || { slug: s, name: s, kind: "" });
  const books = list.filter((p) => p.kind === "book").map((p) => p.name);
  const other = list.filter((p) => p.kind !== "book").map((p) => p.name);
  const parts = [];
  if (books.length) parts.push((books.length > 1 ? "фотокниги " : "фотокнигу ") + books.join(", "));
  if (other.length) parts.push(other.join(", "));
  return parts.join(" и ");
}

const fail = (reason, message) => ({ ok: false, reason, message });

/**
 * Проверка промокода. Возвращает { ok, reason?, message, code, kind, label, discountKop, freeDelivery, eligibleKop }.
 *  lines   — позиции [{ lineKop, slug? }]; без slug код считается подходящим ко всем позициям;
 *  goodsKop — сумма товаров (если lines не переданы);
 *  userId  — кто применяет (только сервер): null — гость; undefined — не проверять личный код;
 *  usage   — { total, mine } применений (только сервер); undefined — лимиты не проверять;
 *  season  — текущий сезон ('none' | autumn | …); undefined/null — сезон неизвестен, привязку не проверяем;
 *  products — каталог (для названий в сообщениях).
 */
export function checkPromo(promo, { lines, goodsKop, now = new Date(), userId, usage, season, products = [] } = {}) {
  if (!promo) return fail("not_found", "Не подходит: такого промокода нет.");
  if (!promo.active) return fail("disabled", "Не подходит: этот промокод больше не действует.");
  if (promo.ownerUserId && userId !== undefined) {
    if (!userId) return fail("login_required", "Это личный код из открытки — войдите в аккаунт, чтобы применить его.");
    if (userId !== promo.ownerUserId) return fail("not_yours", "Не подходит: это личный код другого клиента.");
  }
  const t = now.getTime();
  if (promo.validFrom && t < new Date(promo.validFrom).getTime()) {
    return fail("not_started", `Не подходит: промокод начнёт действовать ${promoDate(promo.validFrom)}.`);
  }
  if (promo.validTo && t > new Date(promo.validTo).getTime()) {
    return fail("expired", `Истёк: промокод действовал до ${promoDate(promo.validTo)}.`);
  }
  if (promo.season && season && season !== promo.season) {
    return fail("season_off", `Не подходит: это код сезона «${SEASON_LABELS[promo.season] || promo.season}» — сейчас он не действует.`);
  }
  if (usage) {
    if (promo.maxUses != null && usage.total >= promo.maxUses) {
      return promo.personal || promo.ownerUserId
        ? fail("used", "Код уже использован: личный код из открытки действует один раз.")
        : fail("limit", "Лимит использований исчерпан: промокод уже применили максимальное число раз.");
    }
    if (promo.maxUsesPerUser != null && usage.mine >= promo.maxUsesPerUser) {
      return promo.maxUsesPerUser === 1
        ? fail("limit_user", "Код уже использован: его можно применить один раз.")
        : fail("limit_user", `Лимит использований исчерпан: этот код можно применить ${promo.maxUsesPerUser} раза.`);
    }
  }
  const all = Array.isArray(lines) ? lines : null;
  const total = all ? all.reduce((s, l) => s + (l.lineKop || 0), 0) : goodsKop || 0;
  const restricted = (promo.productSlugs || []).length > 0;
  let eligibleKop = total;
  if (restricted && all) {
    const fit = all.filter((l) => !l.slug || promo.productSlugs.includes(l.slug));
    if (!fit.length) {
      return fail("wrong_product", `Не для этого продукта: код действует только на ${productsText(promo.productSlugs, products)}.`);
    }
    eligibleKop = fit.reduce((s, l) => s + (l.lineKop || 0), 0);
  }
  if (eligibleKop < (promo.minTotalKop || 0)) {
    const what = restricted ? ` на ${productsText(promo.productSlugs, products)}` : "";
    return {
      ...fail("min_total", `Не подходит: минимальная сумма заказа${what} — ${byn(promo.minTotalKop)}. Добавьте ещё ${byn(promo.minTotalKop - eligibleKop)}.`),
      minTotalKop: promo.minTotalKop,
    };
  }
  let discountKop = 0;
  if (promo.kind === "percent") discountKop = Math.round((eligibleKop * promo.value) / 100);
  if (promo.kind === "amount") discountKop = Math.min(promo.value, eligibleKop);
  return {
    ok: true,
    code: promo.code,
    kind: promo.kind,
    label: promo.label || "",
    discountKop,
    eligibleKop,
    freeDelivery: promo.kind === "free_delivery",
    message: "Промокод применён",
  };
}
