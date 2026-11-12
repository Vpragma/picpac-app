// Админка → «Заказы» (N9, только админ): поиск по номеру, фильтры (статус, даты, продукт, просрочен, на модерации,
// источник), сортировка, страницы и выгрузка в CSV без персональных данных. Форма работает без JS (method="get").
import Link from "next/link";
import { StatusChip } from "@/components/OrderBits";
import { ORDER_SORTS, ORDER_SOURCES, orderFilters, orderParams, queryOrders } from "@/lib/server/adminOrders";
import { loadCatalog } from "@/lib/server/catalog";
import { STATUS_LABELS } from "@/lib/server/orders";
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Заказы — PicPac" };

const time = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const byn = (kop) => (Math.round(kop || 0) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " BYN";

export default async function AdminOrdersPage({ searchParams }) {
  await requirePageRole(["admin"], "/admin/orders");
  const raw = orderParams(await searchParams);
  const parsed = orderFilters.safeParse(raw);
  const f = parsed.success ? parsed.data : {};
  const db = createSupabaseAdmin();

  const [catalog, res] = await Promise.all([
    loadCatalog().catch(() => ({ products: [] })),
    queryOrders(db, f).catch((e) => {
      console.error(e?.message);
      return null;
    }),
  ]);
  const failed = !res;
  const names = Object.fromEntries(catalog.products.map((p) => [p.slug, p.name]));

  // Ссылка с теми же фильтрами + изменения
  const link = (patch = {}, base = "/admin/orders") => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...patch })) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return base + (s ? "?" + s : "");
  };
  const exportHref = link({ page: undefined, per: undefined }, "/api/v1/admin/orders/export");
  const active = ["q", "status", "product", "from", "to", "overdue", "moderation", "source"].filter((k) => f[k]).length;

  return (
    <div>
      <div className="row between wrap">
        <h1>Заказы</h1>
        <a className="btn btn-small" href={exportHref} download data-testid="orders-csv">
          Скачать CSV
        </a>
      </div>
      <p className="muted small">Время — по Минску. В CSV — номер, дата, продукт, сумма, статус и город: без имён, телефонов, адресов и почты. Выгрузка записывается в журнал.</p>

      <nav className="filters" aria-label="Быстрые фильтры заказов">
        <Link className={"filter-chip" + (!active ? " active" : "")} href="/admin/orders" aria-current={!active ? "true" : undefined}>
          Все
        </Link>
        <a className={"filter-chip" + (f.overdue ? " active" : "")} href={link({ overdue: f.overdue ? undefined : "1", page: undefined })} aria-current={f.overdue ? "true" : undefined} data-testid="orders-overdue">
          Просрочены
        </a>
        <a className={"filter-chip" + (f.moderation ? " active" : "")} href={link({ moderation: f.moderation ? undefined : "1", page: undefined })} aria-current={f.moderation ? "true" : undefined}>
          На модерации
        </a>
        <a className={"filter-chip" + (f.source === "real" ? " active" : "")} href={link({ source: f.source === "real" ? undefined : "real", page: undefined })} aria-current={f.source === "real" ? "true" : undefined}>
          Без синтетики
        </a>
      </nav>

      <details className="card" open={active > 0}>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 500 }}>Поиск и фильтры{active ? ` · включено: ${active}` : ""}</summary>
        <form method="get" action="/admin/orders" style={{ marginTop: 12 }} data-testid="orders-filters">
          <div className="admin-filters">
            <label className="field">
              <span>Номер заказа</span>
              <input className="input" name="q" defaultValue={f.q || ""} maxLength={40} placeholder="PP-261112-10023 или 10023" autoComplete="off" spellCheck={false} />
            </label>
            <label className="field">
              <span>Статус</span>
              <select className="input" name="status" defaultValue={f.status || ""}>
                <option value="">Любой</option>
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Продукт</span>
              <select className="input" name="product" defaultValue={f.product || ""}>
                <option value="">Любой</option>
                {catalog.products.map((p) => (
                  <option key={p.slug} value={p.slug}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>С (дата по Минску)</span>
              <input className="input" type="date" name="from" defaultValue={f.from || ""} />
            </label>
            <label className="field">
              <span>По (включительно)</span>
              <input className="input" type="date" name="to" defaultValue={f.to || ""} />
            </label>
            <label className="field">
              <span>Источник</span>
              <select className="input" name="source" defaultValue={f.source || "all"}>
                {Object.entries(ORDER_SOURCES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Сортировка</span>
              <select className="input" name="sort" defaultValue={f.sort || "new"}>
                {Object.entries(ORDER_SORTS).map(([k, s]) => (
                  <option key={k} value={k}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <label className="admin-check">
                <input type="checkbox" name="overdue" value="1" defaultChecked={!!f.overdue} /> Просрочен
              </label>
              <label className="admin-check">
                <input type="checkbox" name="moderation" value="1" defaultChecked={!!f.moderation} /> На модерации
              </label>
            </div>
          </div>
          <div className="admin-actions">
            <button className="btn btn-primary" type="submit">
              Найти
            </button>
            <Link className="btn" href="/admin/orders">
              Сбросить
            </Link>
          </div>
        </form>
      </details>

      {!parsed.success && (
        <div className="card" role="alert">
          <b className="err-text">Фильтр не распознан — показаны все заказы.</b>
          <p className="muted small">{parsed.error.issues[0]?.message}</p>
        </div>
      )}
      {failed && (
        <div className="card" role="alert">
          <b className="err-text">Не получилось загрузить заказы.</b>
          <p className="muted">Обновите страницу через минуту.</p>
        </div>
      )}
      {res && (
        <>
          <p className="small" aria-live="polite" data-testid="orders-summary">
            {res.total ? `Найдено заказов: ${res.total.toLocaleString("ru-RU")}. Страница ${res.page} из ${res.pages}.` : "По этим фильтрам заказов нет."}
          </p>
          {!!res.items.length && (
            <div className="table-wrap">
              <table className="data-table" data-testid="orders-table">
                <thead>
                  <tr>
                    <th scope="col">№</th>
                    <th scope="col">Создан</th>
                    <th scope="col">Продукт</th>
                    <th scope="col" className="num">
                      Сумма
                    </th>
                    <th scope="col">Статус</th>
                    <th scope="col">Город</th>
                    <th scope="col">Срок</th>
                  </tr>
                </thead>
                <tbody>
                  {res.items.map((o) => (
                    <tr key={o.id}>
                      <td>
                        <Link href={`/admin/orders/${o.id}`}>{o.number}</Link>
                        {o.isSynthetic ? <span className="muted small"> · синт.</span> : null}
                        {o.isDemo ? <span className="muted small"> · демо</span> : null}
                      </td>
                      <td className="num">{time(o.createdAt)}</td>
                      <td>{o.products.map((s) => names[s] || s).join(", ") || "—"}</td>
                      <td className="num">
                        {byn(o.totalKop)}
                        {o.promoCode ? <span className="muted small"> · {o.promoCode}</span> : null}
                      </td>
                      <td>
                        <StatusChip status={o.status} />
                        {!o.paid && <span className="muted small"> · не оплачен</span>}
                      </td>
                      <td className="wrap-any">{o.city || "—"}</td>
                      <td className="num">{o.overdue ? <b className="err-text">просрочен</b> : time(o.etaTo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.pages > 1 && (
            <nav className="admin-pager" aria-label="Страницы списка заказов">
              {res.page > 1 ? (
                <a className="btn btn-small" href={link({ page: res.page > 2 ? res.page - 1 : undefined })} rel="prev">
                  ← Назад
                </a>
              ) : null}
              <span className="muted small">
                {res.page} / {res.pages}
              </span>
              {res.page < res.pages ? (
                <a className="btn btn-small" href={link({ page: res.page + 1 })} rel="next" data-testid="orders-next">
                  Дальше →
                </a>
              ) : null}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
