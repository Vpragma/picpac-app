import "server-only";
// Промокоды на сервере (N8): чтение из базы без кэша (срок, лимиты и «выключен» важны сразу),
// учёт применений, текущий сезон, личные коды-открытки к заказам.
import { randomInt } from "node:crypto";
import { CARD_TERMS, checkPromo, normalizeCode, publicPromo, SEASONS, shapePromo } from "../promo";
import { readSeason } from "./season";
import { createSupabaseAdmin } from "./supabaseAdmin";

export async function findPromoFull(code, db = createSupabaseAdmin()) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const { data, error } = await db.from("promo_codes").select("*").eq("code", normalized).maybeSingle();
  if (error || !data) return null;
  return shapePromo(data);
}

// Сколько раз код применён: всего и этим клиентом (учёт — promo_redemptions)
export async function promoUsage(code, userId, db = createSupabaseAdmin()) {
  const [all, mine] = await Promise.all([
    db.from("promo_redemptions").select("id", { count: "exact", head: true }).eq("code", code),
    userId ? db.from("promo_redemptions").select("id", { count: "exact", head: true }).eq("code", code).eq("user_id", userId) : { count: 0 },
  ]);
  if (all.error || mine.error) throw new Error("Учёт промокодов не прочитался: " + (all.error || mine.error).message);
  return { total: all.count || 0, mine: mine.count || 0 };
}

// Текущий сезон — из N2 (таблица site_season через кэш данных Next; договор — docs/night/night2-seasons.md).
// Не прочитался → null: привязку кода к сезону не проверяем, всё работает.
export async function currentSeason() {
  try {
    const value = await readSeason();
    if (value === "none") return "none";
    return SEASONS.includes(value) ? value : null;
  } catch {
    return null;
  }
}

// Действующий сезонный код для плашки (главная, корзина): включён, общий (не личный), в сроке, нужного сезона,
// лимит «всего» не исчерпан. Нет — null.
export async function findSeasonalPromo(season, db = createSupabaseAdmin()) {
  if (!SEASONS.includes(season)) return null;
  const t = Date.now();
  const { data, error } = await db
    .from("promo_codes")
    .select("*")
    .eq("season", season)
    .eq("active", true)
    .is("owner_user_id", null)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const row = (data || []).find((r) => (!r.valid_from || new Date(r.valid_from).getTime() <= t) && (!r.valid_to || new Date(r.valid_to).getTime() >= t));
  const p = shapePromo(row);
  if (p?.maxUses != null) {
    const { count } = await db.from("promo_redemptions").select("id", { count: "exact", head: true }).eq("code", p.code);
    if ((count || 0) >= p.maxUses) return null;
  }
  return p || null;
}

/**
 * Полная проверка кода для корзины: условия кода, сезон, продукты, минимальная сумма, личный код, лимиты.
 * lines — позиции корзины сервера [{ lineKop, slug }]. userId — null для гостя.
 * Возвращает { promo, result } (promo — null, если кода нет).
 */
export async function checkPromoForCart(code, { lines, goodsKop, userId = null, products = [], now = new Date() }) {
  const promo = await findPromoFull(code);
  if (!promo) return { promo: null, result: checkPromo(null) };
  const needUsage = promo.maxUses != null || promo.maxUsesPerUser != null;
  const [usage, season] = await Promise.all([needUsage ? promoUsage(promo.code, userId) : null, promo.season ? currentSeason() : null]);
  const result = checkPromo(promo, { lines, goodsKop, now, userId, usage: usage || undefined, season, products });
  return { promo, result };
}

// Код открытки: PP + 8 знаков без похожих (0/O, 1/I/L) — легко продиктовать и набрать
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newCardCode() {
  let s = "PP";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

// Условия открытки к заказу (решает сервер)
export function cardTerms(orderNumber, now = new Date()) {
  const validTo = new Date(now.getTime() + CARD_TERMS.days * 24 * 3600 * 1000);
  // Конец дня по Минску (UTC+3)
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Minsk", year: "numeric", month: "2-digit", day: "2-digit" }).format(validTo);
  return {
    code: newCardCode(),
    kind: CARD_TERMS.kind,
    value: CARD_TERMS.value,
    min_total_kop: CARD_TERMS.minTotalKop,
    valid_to: `${ymd}T23:59:59+03:00`,
    label: `${orderNumber ? `Открытка к заказу ${orderNumber}` : "Открытка"}: −${CARD_TERMS.value}% на следующий заказ`,
  };
}

// Открытка к заказу: выдать, если ещё нет (повтор вернёт тот же код). При совпадении кода — пробуем другой.
export async function issueCard(userId, orderId, orderNumber, db = createSupabaseAdmin()) {
  for (let i = 0; i < 3; i++) {
    const { data, error } = await db.rpc("issue_order_card", { _user: userId, _order: orderId, _card: cardTerms(orderNumber) });
    if (error) throw new Error(error.message);
    if (data) return data;
  }
  return null;
}

// Личные коды клиента по заказам: { [orderId]: card }. used — код уже применён в другом заказе.
export async function cardsByOrder(userId, orderIds, db = createSupabaseAdmin()) {
  if (!orderIds.length) return {};
  const { data, error } = await db
    .from("promo_codes")
    .select("code, kind, value, min_total_kop, valid_from, valid_to, label, active, product_slugs, season, owner_user_id, source_order_id")
    .eq("owner_user_id", userId)
    .in("source_order_id", orderIds);
  if (error || !data?.length) return {};
  const codes = data.map((r) => r.code);
  const { data: used } = await db.from("promo_redemptions").select("code, order_id").in("code", codes);
  const usedIn = new Map((used || []).map((u) => [u.code, u.order_id]));
  const out = {};
  for (const r of data) out[r.source_order_id] = shapeCard(shapePromo(r), usedIn.get(r.code) || null);
  return out;
}

export function shapeCard(p, usedOrderId = null, now = new Date()) {
  if (!p) return null;
  const expired = !!p.validTo && now.getTime() > new Date(p.validTo).getTime();
  return {
    ...publicPromo(p),
    used: !!usedOrderId,
    usedOrderId,
    expired,
    status: usedOrderId ? "used" : expired ? "expired" : p.active ? "active" : "disabled",
  };
}
