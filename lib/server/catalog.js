import "server-only";
// Каталог из базы (таблицы products, product_sizes, product_options, delivery_methods, promo_codes).
// Держим копию в памяти на 60 секунд, чтобы не читать базу на каждый запрос.
import { createSupabaseAdmin } from "./supabaseAdmin";

const TTL_MS = 60_000;
let cache = null;
let cachedAt = 0;

const byn = (kop) => (kop == null ? null : Math.round(kop) / 100);

function shapeProduct(row, sizes, options) {
  const mySizes = sizes
    .filter((s) => s.product_slug === row.slug)
    .map((s) => ({
      id: s.code,
      code: s.code,
      label: s.label,
      w: Number(s.width_cm),
      h: Number(s.height_cm),
      k: Number(s.price_k),
      unitPriceKop: s.unit_price_kop,
      unitPrice: byn(s.unit_price_kop),
    }));
  const groups = {};
  for (const o of options.filter((x) => x.product_slug === row.slug)) {
    (groups[o.option_group] ||= []).push({ id: o.code, label: o.label, note: o.note, priceDeltaKop: o.price_delta_kop, default: o.is_default });
  }
  const isBook = row.kind === "book";
  const p = {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    badge: row.badge || undefined,
    tagline: row.tagline,
    description: row.description,
    printDays: row.print_days,
    sizes: mySizes,
    options: groups,
    covers: groups.cover,
    surfaces: groups.surface,
    photos: { min: row.min_photos, max: row.max_photos },
    requirements: row.photo_requirements,
    // Поля для формул (lib/pricing.js)
    minPages: row.min_pages,
    maxPages: row.max_pages,
    pageStep: row.page_step,
    basePriceKop: row.base_price_kop,
    per2PagesKop: row.per2_pages_kop,
  };
  if (isBook) {
    p.pages = { min: row.min_pages, max: row.max_pages, step: row.page_step };
    p.price = { currency: row.currency, base: byn(row.base_price_kop), per2Pages: byn(row.per2_pages_kop), basedOnSize: mySizes[0]?.code || "20x20" };
    p.priceFromKop = row.base_price_kop;
  } else {
    p.price = { currency: row.currency, per: "photo" };
    p.priceFromKop = Math.min(...mySizes.map((s) => s.unitPriceKop));
  }
  p.priceFrom = byn(p.priceFromKop);
  return p;
}

function shapeDelivery(d) {
  return {
    id: d.code,
    code: d.code,
    name: d.name,
    note: d.note,
    priceKop: d.price_kop,
    price: byn(d.price_kop),
    freeFromKop: d.free_from_kop,
    freeFrom: byn(d.free_from_kop),
    eta: d.eta_text,
    minDays: d.min_days,
    maxDays: d.max_days,
    addressFields: d.address_fields || [],
  };
}

export async function loadCatalog({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cachedAt < TTL_MS) return cache;
  const db = createSupabaseAdmin();
  const [p, s, o, d] = await Promise.all([
    db.from("products").select("*").eq("active", true).order("sort"),
    db.from("product_sizes").select("*").eq("active", true).order("sort"),
    db.from("product_options").select("*").order("sort"),
    db.from("delivery_methods").select("*").eq("active", true).order("sort"),
  ]);
  const error = p.error || s.error || o.error || d.error;
  if (error) throw new Error("Каталог не загрузился: " + error.message);
  const updated = p.data.map((r) => r.updated_at).sort().pop() || null;
  cache = {
    version: updated,
    currency: "BYN",
    timezone: "Europe/Minsk",
    products: p.data.map((r) => shapeProduct(r, s.data, o.data)),
    delivery: d.data.map(shapeDelivery),
  };
  cachedAt = Date.now();
  return cache;
}

export function findProduct(catalog, slug) {
  return catalog.products.find((p) => p.slug === slug) || null;
}

export function findDelivery(catalog, code) {
  return catalog.delivery.find((d) => d.code === code) || null;
}

// Промокод из базы (без кэша: срок и активность важны)
export async function findPromo(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(normalized)) return null;
  const { data, error } = await createSupabaseAdmin().from("promo_codes").select("*").eq("code", normalized).maybeSingle();
  if (error || !data) return null;
  return {
    code: data.code,
    kind: data.kind,
    value: data.value,
    minTotalKop: data.min_total_kop,
    validFrom: data.valid_from,
    validTo: data.valid_to,
    label: data.label,
    active: data.active,
  };
}

// Проверка опций проекта по каталогу. { options } с подставленными значениями по умолчанию или { error }
export function normalizeOptions(product, input = {}) {
  const out = { ...input };
  if (!out.size) out.size = product.sizes[0]?.code;
  if (!product.sizes.some((s) => s.code === out.size)) return { error: `Размер ${out.size} для «${product.name}» не выпускается. Выберите размер из списка.` };
  if (product.kind === "book") {
    if (out.pages == null) out.pages = product.minPages;
    const okPages = Number.isInteger(out.pages) && out.pages >= product.minPages && out.pages <= product.maxPages && (out.pages - product.minPages) % (product.pageStep || 2) === 0;
    if (!okPages) return { error: `Число страниц для «${product.name}» — от ${product.minPages} до ${product.maxPages}, чётное.` };
  } else {
    delete out.pages;
  }
  for (const [group, list] of Object.entries(product.options || {})) {
    const def = list.find((x) => x.default) || list[0];
    if (out[group] == null) out[group] = def.id;
    else if (!list.some((x) => x.id === out[group])) return { error: `Вариант «${out[group]}» не подходит для «${product.name}».` };
  }
  for (const key of ["cover", "lamination", "paper", "print", "surface"]) {
    if (out[key] != null && !product.options?.[key]) return { error: `У «${product.name}» нет настройки «${key}».` };
  }
  return { options: out };
}
