// GET /api/v1/orders/{id} — мой заказ по id или номеру (PP-ГГММДД-NNNNN):
// состав с миниатюрами (подписанные ссылки на 10 минут), суммы, получатель, доставка, лента статусов, обращения.
// Чужой заказ — 404. Демо-заказы при чтении продвигает симулятор ERP (lib/server/orderFlow.js).
import { notFound, requireUser, serverError } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { findDelivery, findProduct, loadCatalog } from "@/lib/server/catalog";
import { advanceDemoOrders } from "@/lib/server/orderFlow";
import { getOwnOrder, loadOrderFull } from "@/lib/server/orders";

const THUMBS_PER_ITEM = 8;

export async function GET(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  try {
    let order = await getOwnOrder(ctx, id);
    if (!order) {
      await ctx.audit("order.view", "order", String(id).slice(0, 60), "denied", { reason: "not_found_or_foreign" });
      return notFound("Заказ");
    }
    if (order.is_demo && order.status !== "done") {
      if (await advanceDemoOrders(ctx, [order])) order = await getOwnOrder(ctx, order.id);
    }
    const full = await loadOrderFull(ctx, order);
    await addThumbs(ctx, full);
    await addLabels(full);
    return json({ ok: true, order: full });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}

// Миниатюры состава: первые фото каждой позиции по подписанным ссылкам (бакет приватный)
async function addThumbs(ctx, order) {
  const want = [];
  for (const it of order.items || []) {
    const photos = (it.snapshot?.photos || []).slice(0, THUMBS_PER_ITEM);
    for (const p of photos) if (p.path?.startsWith(`${ctx.userId}/`)) want.push(p.path);
  }
  const urls = {};
  if (want.length) {
    const { data } = await ctx.admin.storage.from("photos").createSignedUrls(want, 600);
    for (const r of data || []) if (r.signedUrl && !r.error) urls[r.path] = r.signedUrl;
  }
  for (const it of order.items || []) {
    const photos = it.snapshot?.photos || [];
    it.photoCount = it.snapshot?.photoCount ?? photos.length;
    it.thumbs = photos.slice(0, THUMBS_PER_ITEM).map((p) => ({ id: p.id, url: urls[p.path] || null }));
  }
}

const GROUP_LABELS = { cover: "Обложка", lamination: "Ламинация", paper: "Бумага", print: "Печать", surface: "Поверхность" };

// Подписи для экрана: способ доставки и опции позиций словами из каталога
async function addLabels(order) {
  let catalog = null;
  try {
    catalog = await loadCatalog();
  } catch {
    return;
  }
  const m = findDelivery(catalog, order.delivery?.code);
  if (m) order.delivery = { ...order.delivery, name: m.name, note: m.note };
  for (const it of order.items || []) {
    const product = findProduct(catalog, it.productSlug);
    const o = it.options || {};
    const size = product?.sizes.find((x) => x.id === o.size || x.code === o.size);
    const parts = [];
    if (o.size) parts.push(`Размер ${String(o.size).replace("x", "×")}${size?.label ? ` (${size.label.toLowerCase()})` : ""}`);
    if (o.pages) parts.push(`${o.pages} стр.`);
    for (const [g, label] of Object.entries(GROUP_LABELS)) {
      if (o[g] == null) continue;
      const v = product?.options?.[g]?.find((x) => x.id === o[g]);
      parts.push(`${label}: ${v?.label || o[g]}`);
    }
    it.optionsText = parts;
  }
}
