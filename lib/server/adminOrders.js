import "server-only";
// N9: список заказов для администратора — поиск по номеру, фильтры, сортировка, страницы и выгрузка CSV.
// Читаем сервисным ключом ПОСЛЕ проверки роли admin (proxy.js + requireApiRole/requirePageRole).
// В выгрузке нет персональных данных: только номер, дата, продукт (из каталога), сумма, статус и город.
import { z } from "zod";
import { csvLine } from "../csv";
import { STATUS_LABELS, STATUSES } from "./orders";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата — в виде ГГГГ-ММ-ДД.");

// Сортировки: ключ → [столбец, по возрастанию]
export const ORDER_SORTS = {
  new: { label: "Сначала новые", col: "created_at", asc: false },
  old: { label: "Сначала старые", col: "created_at", asc: true },
  sum_desc: { label: "Сумма: больше", col: "total_kop", asc: false },
  sum_asc: { label: "Сумма: меньше", col: "total_kop", asc: true },
  changed: { label: "Недавно сменили статус", col: "status_changed_at", asc: false },
  eta: { label: "Срок готовности: раньше", col: "eta_to", asc: true },
};

export const ORDER_SOURCES = { all: "Все", real: "Без синтетики", synthetic: "Только синтетика" };

// Фильтры из адреса: строгая схема — лишний параметр → 400 (API) или подсказка (экран)
export const orderFilters = z.strictObject({
  q: z.string().trim().max(40, "Номер — до 40 знаков.").regex(/^[A-Za-z0-9-]*$/, "Номер — латинские буквы, цифры и дефис.").optional(),
  status: z.enum(STATUSES).optional(),
  product: z.string().regex(/^[a-z0-9-]{2,40}$/, "Неверный продукт.").optional(),
  from: day.optional(),
  to: day.optional(),
  overdue: z.enum(["1"]).optional(),
  moderation: z.enum(["1"]).optional(),
  source: z.enum(Object.keys(ORDER_SOURCES)).optional(),
  sort: z.enum(Object.keys(ORDER_SORTS)).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  per: z.coerce.number().int().min(10).max(100).optional(),
});

// Параметры адреса → объект для схемы (пустые поля формы — не фильтр)
export function orderParams(params) {
  const out = {};
  for (const [k, v] of params instanceof URLSearchParams ? params.entries() : Object.entries(params || {})) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value === undefined || value === null || String(value).trim() === "") continue;
    out[k] = String(value).trim();
  }
  return out;
}

// Минск — UTC+3 круглый год
const minskStart = (d) => `${d}T00:00:00+03:00`;
const nextDay = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
};

const OPEN = ["accepted", "moderation", "production"];

function applyOrderFilters(q, f) {
  // Номер: только буквы, цифры и дефис (схема) — подстановочных знаков LIKE в запросе нет
  if (f.q) q = q.ilike("number", `%${f.q}%`);
  if (f.status) q = q.eq("status", f.status);
  if (f.moderation) q = q.eq("status", "moderation");
  if (f.product) q = q.eq("order_items.product_slug", f.product);
  if (f.from) q = q.gte("created_at", minskStart(f.from));
  if (f.to) q = q.lt("created_at", minskStart(nextDay(f.to)));
  // Просрочен — как в статистике: не готов и не завершён, а срок готовности прошёл
  if (f.overdue) q = q.in("status", OPEN).lt("eta_to", new Date().toISOString());
  if (f.source === "real") q = q.eq("is_synthetic", false);
  if (f.source === "synthetic") q = q.eq("is_synthetic", true);
  return q;
}

const COLUMNS = "id, number, status, substatus, total_kop, payment_status, is_demo, is_synthetic, created_at, status_changed_at, eta_to, promo_code, city:delivery_address->>city, pickup:delivery_address->>pickup_point";

function select(db, f, count) {
  const items = f.product ? "order_items!inner(product_slug, quantity)" : "order_items(product_slug, quantity)";
  return db.from("orders").select(`${COLUMNS}, ${items}`, count ? { count: "exact" } : undefined);
}

const isOverdue = (o, now = Date.now()) => OPEN.includes(o.status) && o.eta_to && new Date(o.eta_to).getTime() < now;

function shape(o) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    statusLabel: STATUS_LABELS[o.status] || o.status,
    substatus: o.substatus,
    totalKop: o.total_kop,
    paid: o.payment_status === "paid_test",
    createdAt: o.created_at,
    statusChangedAt: o.status_changed_at,
    etaTo: o.eta_to,
    overdue: !!isOverdue(o),
    promoCode: o.promo_code || null,
    city: o.city || (o.pickup ? "пункт выдачи" : ""),
    products: [...new Set((o.order_items || []).map((i) => i.product_slug))],
    isSynthetic: o.is_synthetic,
    isDemo: o.is_demo,
  };
}

// Страница заказов: { items, total, page, per, pages }
export async function queryOrders(db, f = {}) {
  const per = f.per || 25;
  const page = f.page || 1;
  const sort = ORDER_SORTS[f.sort || "new"];
  let q = applyOrderFilters(select(db, f, true), f).order(sort.col, { ascending: sort.asc, nullsFirst: false }).order("number", { ascending: sort.asc });
  q = q.range((page - 1) * per, page * per - 1);
  const { data, error, count } = await q;
  if (error) throw new Error("Заказы не загрузились: " + error.message);
  const total = count ?? data.length;
  return { items: data.map(shape), total, page, per, pages: Math.max(1, Math.ceil(total / per)) };
}

export const EXPORT_LIMIT = 10_000;

// Все заказы по фильтрам для выгрузки (частями по 1000 — предел ответа базы), не больше EXPORT_LIMIT
export async function exportOrders(db, f = {}) {
  const sort = ORDER_SORTS[f.sort || "new"];
  const out = [];
  for (let from = 0; from < EXPORT_LIMIT; from += 1000) {
    const q = applyOrderFilters(select(db, f, false), f)
      .order(sort.col, { ascending: sort.asc, nullsFirst: false })
      .order("number", { ascending: sort.asc })
      .range(from, Math.min(from + 999, EXPORT_LIMIT - 1));
    const { data, error } = await q;
    if (error) throw new Error("Выгрузка не удалась: " + error.message);
    out.push(...data.map(shape));
    if (data.length < 1000) break;
  }
  return out;
}

const minskDateTime = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Minsk", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Столбцы CSV — ровно эти; персональных полей (имя, телефон, почта, адрес) нет
export const CSV_COLUMNS = ["Номер", "Дата (Минск)", "Продукт", "Сумма, BYN", "Статус", "Город"];

// Заказы → текст CSV (разделитель «;», как ждёт Excel с русскими настройками; BOM — чтобы кириллица открылась верно)
export function ordersCsv(rows, productNames = {}) {
  const lines = [csvLine(CSV_COLUMNS)];
  for (const o of rows) {
    lines.push(
      csvLine([
        o.number,
        minskDateTime.format(new Date(o.createdAt)).replace(",", ""),
        o.products.map((s) => productNames[s] || s).join(", "),
        (o.totalKop / 100).toFixed(2).replace(".", ","),
        o.statusLabel,
        o.city,
      ]),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
