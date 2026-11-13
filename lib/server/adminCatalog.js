import "server-only";
// N9: правка каталога администратором — цены, коэффициенты размеров, плашки и старая цена («скидка»).
// Проверки на сервере: только положительные цены в разумных пределах, старая цена больше текущей «от».
// Клиентская цена всегда пересчитывается сервером по каталогу из базы (lib/pricing.js) — подменить её нельзя.
import { z } from "zod";
import { invalidateCatalog } from "./catalog";

export const BADGES = ["новинка", "скидка", "выбор pic pac"];

// Пределы (копейки BYN): книга 1–10 000 BYN, надбавка за 2 страницы 0,01–1000 BYN, отпечаток 0,01–1000 BYN
export const LIMITS = {
  basePriceKop: [100, 1_000_000],
  per2PagesKop: [1, 100_000],
  unitPriceKop: [1, 100_000],
  priceK: [0.1, 10],
  oldPriceKop: [1, 10_000_000],
};

const kop = (key, label) =>
  z
    .number({ error: `${label} — число в копейках.` })
    .int(`${label} — целое число копеек.`)
    .min(LIMITS[key][0], `${label} — не меньше ${(LIMITS[key][0] / 100).toFixed(2).replace(".", ",")} BYN.`)
    .max(LIMITS[key][1], `${label} — не больше ${(LIMITS[key][1] / 100).toLocaleString("ru-RU")} BYN.`);

export const catalogPatch = z.strictObject({
  basePriceKop: kop("basePriceKop", "Цена книги").optional(),
  per2PagesKop: kop("per2PagesKop", "Надбавка за 2 страницы").optional(),
  badge: z.enum(BADGES, { error: "Плашка — «новинка», «скидка», «выбор pic pac» или без плашки." }).nullable().optional(),
  oldPriceKop: kop("oldPriceKop", "Старая цена").nullable().optional(),
  sizes: z
    .array(
      z.strictObject({
        code: z.string().regex(/^[0-9]{1,3}x[0-9]{1,3}$/, "Неверный размер."),
        priceK: z.number({ error: "Коэффициент — число." }).min(LIMITS.priceK[0], "Коэффициент — не меньше 0,1.").max(LIMITS.priceK[1], "Коэффициент — не больше 10.").optional(),
        unitPriceKop: kop("unitPriceKop", "Цена отпечатка").optional(),
      }),
    )
    .max(30)
    .optional(),
});

// Каталог для админки: все продукты и размеры (в том числе выключенные), цены «от»
export async function loadAdminCatalog(db) {
  const [p, s] = await Promise.all([
    db.from("products").select("slug, name, kind, badge, base_price_kop, per2_pages_kop, old_price_kop, min_pages, active, sort, updated_at").order("sort"),
    db.from("product_sizes").select("product_slug, code, label, price_k, unit_price_kop, active, sort").order("sort"),
  ]);
  const error = p.error || s.error;
  if (error) throw new Error("Каталог не загрузился: " + error.message);
  return p.data.map((r) => shapeAdmin(r, s.data.filter((x) => x.product_slug === r.slug)));
}

function priceFrom(kind, baseKop, sizes) {
  if (kind === "book") return baseKop;
  const prices = sizes.filter((x) => x.active !== false && x.unitPriceKop != null).map((x) => x.unitPriceKop);
  return prices.length ? Math.min(...prices) : null;
}

function shapeAdmin(r, sizes) {
  const sz = sizes.map((x) => ({ code: x.code, label: x.label, priceK: Number(x.price_k), unitPriceKop: x.unit_price_kop, active: x.active }));
  return {
    slug: r.slug,
    name: r.name,
    kind: r.kind,
    active: r.active,
    badge: r.badge || null,
    basePriceKop: r.base_price_kop,
    per2PagesKop: r.per2_pages_kop,
    oldPriceKop: r.old_price_kop ?? null,
    priceFromKop: priceFrom(r.kind, r.base_price_kop, sz),
    sizes: sz,
    updatedAt: r.updated_at,
  };
}

// Правка одного продукта. { product, changes } или { error: { status, code, message, field } }
export async function updateProduct(db, slug, patch) {
  const list = await loadAdminCatalog(db);
  const cur = list.find((p) => p.slug === slug);
  if (!cur) return { error: { status: 404, code: "not_found", message: "Продукт не найден." } };
  const isBook = cur.kind === "book";
  if (!isBook && (patch.basePriceKop != null || patch.per2PagesKop != null)) {
    return { error: { status: 400, code: "invalid_input", message: "У печати фото цена задаётся для каждого размера.", field: "basePriceKop" } };
  }
  const changes = {};
  const prod = {};
  const set = (field, col, value) => {
    if (value === undefined || value === cur[field]) return;
    changes[field] = { from: cur[field], to: value };
    prod[col] = value;
  };
  set("basePriceKop", "base_price_kop", patch.basePriceKop);
  set("per2PagesKop", "per2_pages_kop", patch.per2PagesKop);
  set("badge", "badge", patch.badge);

  // Размеры: только существующие коды; коэффициент — у книг, цена отпечатка — у печати фото
  const sizeUpdates = [];
  for (const s of patch.sizes || []) {
    const old = cur.sizes.find((x) => x.code === s.code);
    if (!old) return { error: { status: 400, code: "invalid_input", message: `Размера ${s.code} у «${cur.name}» нет.`, field: "sizes" } };
    const upd = {};
    if (s.priceK !== undefined) {
      if (!isBook) return { error: { status: 400, code: "invalid_input", message: "Коэффициент размера есть только у книг.", field: "sizes" } };
      const k = Math.round(s.priceK * 1000) / 1000;
      if (k !== old.priceK) {
        upd.price_k = k;
        changes[`size:${s.code}:priceK`] = { from: old.priceK, to: k };
      }
    }
    if (s.unitPriceKop !== undefined) {
      if (isBook) return { error: { status: 400, code: "invalid_input", message: "У книги цена задаётся ценой «от» и коэффициентом размера.", field: "sizes" } };
      if (s.unitPriceKop !== old.unitPriceKop) {
        upd.unit_price_kop = s.unitPriceKop;
        changes[`size:${s.code}:unitPriceKop`] = { from: old.unitPriceKop, to: s.unitPriceKop };
      }
    }
    if (Object.keys(upd).length) sizeUpdates.push({ code: s.code, upd });
  }

  // Старая цена — больше новой цены «от» (с учётом правок в этом же запросе), иначе «скидки» нет
  const nextSizes = cur.sizes.map((x) => {
    const u = sizeUpdates.find((y) => y.code === x.code)?.upd || {};
    return { ...x, unitPriceKop: u.unit_price_kop ?? x.unitPriceKop };
  });
  const nextFrom = priceFrom(cur.kind, prod.base_price_kop ?? cur.basePriceKop, nextSizes);
  const nextOld = patch.oldPriceKop === undefined ? cur.oldPriceKop : patch.oldPriceKop;
  if (nextOld != null && (nextFrom == null || nextOld <= nextFrom)) {
    return {
      error: {
        status: 400,
        code: "old_price",
        message: `Старая цена должна быть больше текущей цены «от» (${((nextFrom || 0) / 100).toFixed(2).replace(".", ",")} BYN) — иначе это не скидка. Уберите старую цену или увеличьте её.`,
        field: "oldPriceKop",
      },
    };
  }
  set("oldPriceKop", "old_price_kop", patch.oldPriceKop);

  if (!Object.keys(changes).length) return { product: cur, changes };
  if (Object.keys(prod).length) {
    const { error } = await db.from("products").update({ ...prod, updated_at: new Date().toISOString() }).eq("slug", slug);
    if (error) throw new Error("Продукт не сохранился: " + error.message);
  }
  for (const s of sizeUpdates) {
    const { error } = await db.from("product_sizes").update(s.upd).eq("product_slug", slug).eq("code", s.code);
    if (error) throw new Error("Размер не сохранился: " + error.message);
  }
  // Цены размеров тоже меняют «версию» каталога (по ней клиенты обновляют копию)
  if (sizeUpdates.length && !Object.keys(prod).length) await db.from("products").update({ updated_at: new Date().toISOString() }).eq("slug", slug);
  invalidateCatalog();
  const fresh = (await loadAdminCatalog(db)).find((p) => p.slug === slug);
  return { product: fresh, changes };
}
