import "server-only";
// Админка «Промокоды» (N8): схема ввода, список со статистикой. Только роль admin (проверяют маршруты).
import { PROMO_KINDS, PROMO_RE, SEASONS, shapePromo } from "../promo";
import { validationError, z } from "./api";
import { jsonError } from "./http";
import { loadCatalog } from "./catalog";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Дата — в формате ГГГГ-ММ-ДД.")
  .nullable()
  .optional();
const limit = z.number().int("Лимит — целое число.").min(1, "Лимит — от 1.").max(1_000_000, "Лимит — до 1 000 000.").nullable().optional();

const fields = {
  kind: z.enum(PROMO_KINDS, { error: "Выберите тип скидки: процент, сумма или бесплатная доставка." }),
  // percent — проценты 1–100; amount — копейки; free_delivery — 0
  value: z.number().int("Скидка — целое число.").min(0, "Скидка не может быть отрицательной.").max(10_000_000),
  minTotalKop: z.number().int().min(0, "Минимальная сумма не может быть отрицательной.").max(10_000_000),
  validFrom: day,
  validTo: day,
  maxUses: limit,
  maxUsesPerUser: limit,
  productSlugs: z.array(z.string().regex(/^[a-z0-9-]{2,40}$/, "Неизвестный продукт.")).max(20),
  season: z.enum(SEASONS, { error: "Сезон: осень, чёрная пятница, новый год или без сезона." }).nullable().optional(),
  label: z.string().trim().max(120, "Описание — до 120 символов."),
  active: z.boolean(),
};

export const createSchema = z
  .strictObject({
    code: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(PROMO_RE, "Код — от 3 до 20 латинских букв и цифр, без пробелов.")),
    ...fields,
    minTotalKop: fields.minTotalKop.default(0),
    productSlugs: fields.productSlugs.default([]),
    label: fields.label.default(""),
    active: fields.active.default(true),
  })
  .superRefine(checkTerms);

export const updateSchema = z
  .strictObject({
    kind: fields.kind.optional(),
    value: fields.value.optional(),
    minTotalKop: fields.minTotalKop.optional(),
    validFrom: day,
    validTo: day,
    maxUses: limit,
    maxUsesPerUser: limit,
    productSlugs: fields.productSlugs.optional(),
    season: fields.season,
    label: fields.label.optional(),
    active: fields.active.optional(),
  })
  .superRefine((b, ctx) => {
    if (!Object.keys(b).length) ctx.addIssue({ code: "custom", path: [], message: "Нечего менять: пришлите хотя бы одно поле." });
  });

function checkTerms(b, ctx) {
  const v = b.value;
  if (b.kind === "percent" && (v < 1 || v > 100)) ctx.addIssue({ code: "custom", path: ["value"], message: "Процент скидки — от 1 до 100." });
  if (b.kind === "amount" && v < 10) ctx.addIssue({ code: "custom", path: ["value"], message: "Сумма скидки — от 0,10 BYN." });
  if (b.validFrom && b.validTo && b.validTo < b.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "Дата окончания раньше даты начала." });
}

// Проверка условий после слияния с текущими значениями (для PATCH)
export function termsError(p) {
  if (p.kind === "percent" && (p.value < 1 || p.value > 100)) return ["value", "Процент скидки — от 1 до 100."];
  if (p.kind === "amount" && p.value < 10) return ["value", "Сумма скидки — от 0,10 BYN."];
  if (p.validFrom && p.validTo && p.validTo < p.validFrom) return ["validTo", "Дата окончания раньше даты начала."];
  return null;
}

// Дата формы (день по Минску) → начало или конец дня; и обратно
export const dayStart = (d) => (d ? `${d}T00:00:00+03:00` : null);
export const dayEnd = (d) => (d ? `${d}T23:59:59+03:00` : null);
export function toDay(ts) {
  if (!ts) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Minsk", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}

// Тело запроса → столбцы promo_codes
export function toRow(b) {
  const row = {};
  if (b.code !== undefined) row.code = b.code;
  if (b.kind !== undefined) row.kind = b.kind;
  if (b.value !== undefined) row.value = b.kind === "free_delivery" ? 0 : b.value;
  if (b.minTotalKop !== undefined) row.min_total_kop = b.minTotalKop;
  if (b.validFrom !== undefined) row.valid_from = dayStart(b.validFrom);
  if (b.validTo !== undefined) row.valid_to = dayEnd(b.validTo);
  if (b.maxUses !== undefined) row.max_uses = b.maxUses;
  if (b.maxUsesPerUser !== undefined) row.max_uses_per_user = b.maxUsesPerUser;
  if (b.productSlugs !== undefined) row.product_slugs = [...new Set(b.productSlugs)];
  if (b.season !== undefined) row.season = b.season || null;
  if (b.label !== undefined) row.label = b.label;
  if (b.active !== undefined) row.active = b.active;
  return row;
}

// Статус кода для админки
export function promoStatus(p, stats, now = new Date()) {
  const t = now.getTime();
  if (!p.active) return "disabled";
  if (p.validTo && t > new Date(p.validTo).getTime()) return "expired";
  if (p.validFrom && t < new Date(p.validFrom).getTime()) return "scheduled";
  if (p.maxUses != null && (stats?.uses || 0) >= p.maxUses) return "exhausted";
  return "active";
}

export function shapeAdminPromo(row, stats, orderNumbers = {}) {
  const p = shapePromo(row);
  const s = stats || { uses: 0, users: 0, goods_kop: 0, discount_kop: 0, total_kop: 0, last_used_at: null };
  return {
    code: p.code,
    kind: p.kind,
    value: p.value,
    minTotalKop: p.minTotalKop,
    validFrom: toDay(p.validFrom),
    validTo: toDay(p.validTo),
    validFromAt: p.validFrom,
    validToAt: p.validTo,
    label: p.label,
    active: p.active,
    productSlugs: p.productSlugs,
    season: p.season,
    maxUses: p.maxUses,
    maxUsesPerUser: p.maxUsesPerUser,
    personal: p.personal,
    sourceOrder: p.sourceOrderId ? orderNumbers[p.sourceOrderId] || null : null,
    isDemo: !!row.is_synthetic,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: promoStatus(p, s),
    stats: {
      uses: Number(s.uses) || 0,
      users: Number(s.users) || 0,
      goodsKop: Number(s.goods_kop) || 0,
      discountKop: Number(s.discount_kop) || 0,
      totalKop: Number(s.total_kop) || 0,
      lastUsedAt: s.last_used_at || null,
    },
  };
}

// Продукты кода есть в каталоге? Текст ошибки или null
export async function unknownProducts(slugs = []) {
  if (!slugs?.length) return null;
  const catalog = await loadCatalog().catch(() => null);
  if (!catalog) return null;
  const bad = slugs.filter((s) => !catalog.products.some((p) => p.slug === s));
  return bad.length ? `Нет такого продукта: ${bad.join(", ")}.` : null;
}

// Условия кода для журнала (без персональных данных)
export function auditTerms(r) {
  return {
    kind: r.kind,
    value: r.value,
    min_total_kop: r.min_total_kop,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    max_uses: r.max_uses,
    max_uses_per_user: r.max_uses_per_user,
    products: r.product_slugs,
    season: r.season,
    active: r.active,
  };
}

// Разбор тела по схеме с понятным текстом: «Проверьте данные: Процент скидки — от 1 до 100.»
// (сообщения схемы уже полные — без приставки с названием поля). { body } или { response } 400.
export function checkBody(schema, raw) {
  const r = schema.safeParse(raw);
  if (r.success) return { body: r.data };
  const fields = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  // Свои тексты схемы — показываем как есть; стандартные тексты zod переводит в понятные validationError
  const STANDARD = /^(Неверн|Слишком (маленькое|большое)|Нераспознан|Invalid|Too (small|big)|Unrecognized|Expected)/i;
  const custom = r.error.issues.find((i) => i.message && !STANDARD.test(i.message));
  if (!custom || r.error.issues.some((i) => i.code === "unrecognized_keys")) return { response: validationError(r.error) };
  return { response: jsonError(400, "invalid_input", `Проверьте данные: ${custom.message}`, { fields }) };
}
