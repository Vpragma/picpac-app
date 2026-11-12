import "server-only";
// Проекты, фото, корзина: общие запросы для обработчиков /api/v1.
// Чтение — от имени пользователя (RLS) и всегда с фильтром по владельцу; запись — сервером.
import { linePrice } from "../pricing";
import { needsModeration } from "../moderation";
import { BUCKET, z } from "./api";
import { findProduct, loadCatalog } from "./catalog";
import { serverEdits, serverEditsMap } from "../photo/edits";

export const PROJECT_FIELDS = "id, product_slug, title, options, status, version, created_at, updated_at";
export const PHOTO_FIELDS = "id, project_id, storage_path, print_path, mime, bytes, width, height, position, edits, quality, nsfw, moderation_flag, created_at";

const code = z.string().regex(/^[a-z0-9-]{1,30}$/, "Неверный вариант.");
export const optionsSchema = z
  .object({
    size: z.string().regex(/^\d{1,3}x\d{1,3}$/, "Выберите размер из каталога.").optional(),
    pages: z.number().int("Число страниц — целое.").min(2).max(500).optional(),
    cover: code.optional(),
    lamination: code.optional(),
    paper: code.optional(),
    print: code.optional(),
    surface: code.optional(),
    // Настройки редактора и раскладки (без проверки структуры, но с ограничением размера)
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict("Неизвестная настройка проекта.")
  .refine((o) => !o.settings || JSON.stringify(o.settings).length <= 50_000, "Слишком много настроек проекта (больше 50 КБ).");

// N7 (требование жюри N3): местные правки фото — маски выделения, ластик, «убери солнце» с координатами — живут
// только на устройстве. Приложение их не присылает (lib/sync.js, lib/photo/print.js); если пришлёт старая версия
// из кэша телефона — сервер их не сохраняет: в проекте и в фото остаются только общие параметры правок.
export function withoutLocalEdits(options) {
  const edits = options?.settings?.edits;
  if (!edits || typeof edits !== "object") return options;
  const clean = serverEditsMap(edits);
  const settings = { ...options.settings };
  if (Object.keys(clean).length) settings.edits = clean;
  else delete settings.edits;
  return { ...options, settings };
}
export function photoEditsForServer(edits) {
  return edits && typeof edits === "object" ? serverEdits(edits, edits.local) || {} : {};
}

// Флаг «проверит модератор» по оценкам: разбор и пороги — lib/moderation.js (общий с экранами и тестами)
export { needsModeration };

// Оценки проверки на устройстве: новые (N4, v: 2 — классификатор обнажённости и CLIP) или старые nsfwjs.
// demo: 1 — пометка «для показа модерации» (кнопка демо в редакторе).
const score = z.number().min(0).max(1);
export const deviceScoresSchema = z.union([
  z.strictObject({
    v: z.literal(2),
    nsfw: score.optional(),
    breast: score.optional(),
    nude: score.optional(),
    sex: score.optional(),
    nazi: score.optional(),
    weapon: score.optional(),
    blood: score.optional(),
    drugs: score.optional(),
    art: score.optional(),
    plain: score.optional(),
    demo: z.literal(1).optional(),
  }),
  z.strictObject({ porn: score, hentai: score, sexy: score, neutral: score.optional(), drawing: score.optional() }),
]);

export function shapeProject(row, photos) {
  const p = {
    id: row.id,
    productSlug: row.product_slug,
    title: row.title,
    options: row.options,
    status: row.status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (photos) p.photos = photos.map(shapePhoto);
  return p;
}

export function shapePhoto(r) {
  return {
    id: r.id,
    projectId: r.project_id,
    mime: r.mime,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    position: r.position,
    edits: r.edits,
    quality: r.quality,
    moderationFlag: r.moderation_flag,
    createdAt: r.created_at,
  };
}

// Свой проект или null (чужой и несуществующий неразличимы: 404)
export async function getOwnProject(ctx, id) {
  const { data, error } = await ctx.db.from("projects").select(PROJECT_FIELDS).eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function listPhotos(ctx, projectId) {
  const { data, error } = await ctx.db
    .from("project_photos")
    .select(PHOTO_FIELDS)
    .eq("project_id", projectId)
    .eq("user_id", ctx.userId)
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);
  return data || [];
}

// Удаление файлов из хранилища пачками по 100
export async function removeFiles(admin, paths) {
  const list = paths.filter(Boolean);
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await admin.storage.from(BUCKET).remove(list.slice(i, i + 100));
    if (error) throw new Error("Хранилище: " + error.message);
  }
  return list.length;
}

// Все файлы пользователя в хранилище, включая незафиксированные загрузки и печатные версии:
// {user_id}/{project_id}/{file} и {user_id}/{project_id}/print/{photo_id}/{file} — папки обходим вглубь (до 4 уровней)
export async function listUserFiles(admin, userId) {
  const out = [];
  const walk = async (prefix, depth) => {
    const { data: items, error } = await admin.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw new Error("Хранилище: " + error.message);
    for (const f of items || []) {
      if (f.id) out.push(`${prefix}/${f.name}`);
      else if (depth < 4) await walk(`${prefix}/${f.name}`, depth + 1);
    }
  };
  await walk(userId, 1);
  return out;
}

// Корзина пользователя с ценами по каталогу: { items, goodsKop, catalog }
export async function loadCart(ctx) {
  const catalog = await loadCatalog();
  const { data, error } = await ctx.db
    .from("cart_items")
    .select("id, project_id, quantity, created_at, projects!inner(id, product_slug, title, options, status, user_id)")
    .eq("user_id", ctx.userId)
    .order("created_at");
  if (error) throw new Error(error.message);
  const rows = data || [];
  const ids = rows.map((r) => r.project_id);
  const counts = {};
  if (ids.length) {
    const { data: photos, error: e2 } = await ctx.db.from("project_photos").select("project_id").in("project_id", ids).eq("user_id", ctx.userId);
    if (e2) throw new Error(e2.message);
    for (const p of photos || []) counts[p.project_id] = (counts[p.project_id] || 0) + 1;
  }
  const items = rows.map((r) => {
    const product = findProduct(catalog, r.projects.product_slug);
    const photoCount = counts[r.project_id] || 0;
    const price = product
      ? linePrice(product, { sizeCode: r.projects.options?.size, pages: r.projects.options?.pages, photoCount, quantity: r.quantity, options: r.projects.options })
      : null;
    return {
      id: r.id,
      projectId: r.project_id,
      title: r.projects.title || product?.name || "Проект",
      product: product ? { slug: product.slug, name: product.name, kind: product.kind, printDays: product.printDays } : null,
      options: r.projects.options,
      quantity: r.quantity,
      photoCount,
      unitPriceKop: price?.unitKop ?? null,
      lineTotalKop: price?.lineKop ?? null,
      valid: !!price,
    };
  });
  const goodsKop = items.reduce((s, i) => s + (i.lineTotalKop || 0), 0);
  return { items, goodsKop, catalog };
}

export function shapeCart({ items, goodsKop }) {
  return {
    items: items.map((i) => ({ ...i, unitPrice: i.unitPriceKop == null ? null : i.unitPriceKop / 100, lineTotal: i.lineTotalKop == null ? null : i.lineTotalKop / 100 })),
    currency: "BYN",
    goodsKop,
    goods: goodsKop / 100,
  };
}
