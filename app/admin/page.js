// Админка → «Обзор»: последние заказы и обращения клиентов из базы (без ФИО и адресов).
// Доступ проверяет сервер: proxy.js и app/admin/layout.js (роль модератора или админа).
// Админ открывает карточку заказа (смена статуса с причиной) и обращение (чат оператора).
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import Link from "next/link";
import { StatusChip } from "@/components/OrderBits";
import { plural } from "@/lib/plural";
import { moderationCounts } from "@/lib/server/moderationCounts";

export const dynamic = "force-dynamic";

const time = (iso) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const byn = (kop) => (kop / 100).toFixed(2).replace(".", ",") + " BYN";
const IT_STATUS = { open: "Ждёт ответа", answered: "Есть ответ", closed: "Закрыто" };

export default async function AdminPage() {
  const auth = await requirePageRole(["moderator", "admin"], "/admin");
  const isAdmin = auth.activeRole === "admin";
  const db = createSupabaseAdmin();
  const head = { count: "exact", head: true };
  const [orders, interactions, mod, production, open] = await Promise.all([
    db.from("orders").select("id, number, status, total_kop, payment_status, is_demo, created_at").order("created_at", { ascending: false }).limit(30),
    db.from("interactions").select("id, topic, kind, status, sla_due, created_at, orders(number)").order("created_at", { ascending: false }).limit(30),
    moderationCounts(db).catch((e) => (console.error(e?.message), null)),
    db.from("orders").select("id", head).eq("status", "production"),
    db.from("interactions").select("id, orders!inner(id)", head).eq("status", "open"),
  ]);
  const orderRows = orders.data || [];
  const itRows = interactions.data || [];
  const n = (r) => (r?.error ? null : (r?.count ?? null));
  // N7: плитки — «сейчас» по всей базе, а не по последним 30 строкам таблиц ниже. Модерация — тот же источник,
  // что очередь модератора и «Статистика» (lib/server/moderationCounts.js): фото и заказы — разные числа с разными подписями.
  const tiles = [
    {
      id: "photos-waiting",
      label: "Фото ждут проверки",
      value: mod?.photosWaiting,
      sub: mod ? (mod.photosWaiting ? `в ${mod.ordersWithPhotos} ${plural(mod.ordersWithPhotos, "заказе", "заказах", "заказах")} · очередь модератора` : "очередь модератора пуста") : null,
      href: "/admin/moderation",
      hrefLabel: "Открыть очередь",
      warn: true,
    },
    {
      id: "orders-moderation",
      label: "Заказы на модерации",
      value: mod?.orders,
      sub: mod?.synthetic ? `из них синтетика: ${mod.synthetic} (фото у них нет)` : "сейчас",
      href: isAdmin ? "/admin/orders?moderation=1" : null,
      hrefLabel: "Открыть список",
    },
    { id: "production", label: "В производстве", value: n(production), sub: "сейчас" },
    { id: "unanswered", label: "Обращения без ответа", value: n(open), sub: "сейчас", warn: true },
  ];
  return (
    <div>
      <h1>Обзор</h1>
      <p className="muted small">
        Плитки — сейчас, по всей базе. Ниже — последние 30 заказов и обращений.{isAdmin ? " Откройте заказ, чтобы сменить статус, или обращение, чтобы ответить клиенту." : ""}
      </p>
      <div className="stat-tiles" data-testid="overview-tiles">
        {tiles.map((t) => (
          <div key={t.id} className={"stat-tile" + (t.warn && t.value > 0 ? " warn" : "")} data-testid={"tile-" + t.id} data-value={t.value ?? ""}>
            <span className="muted small">{t.label}</span>
            <b>{t.value ?? "—"}</b>
            {t.sub && <span className="muted small">{t.sub}</span>}
            {t.href && (
              <Link className="small" href={t.href}>
                {t.hrefLabel}
              </Link>
            )}
          </div>
        ))}
      </div>
      <section className="card" aria-labelledby="it-title">
        <h2 id="it-title" className="admin-h">Обращения</h2>
        {!itRows.length ? (
          <p className="muted">Обращений пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Заказ</th>
                  <th scope="col">Тема</th>
                  <th scope="col">Создано</th>
                  <th scope="col">Ответить до</th>
                  <th scope="col">Статус</th>
                </tr>
              </thead>
              <tbody>
                {itRows.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.orders?.number}</b>
                    </td>
                    <td>
                      {isAdmin ? <Link href={`/admin/support/${i.id}`}>{i.topic}</Link> : i.topic}
                      {i.kind === "reprint" ? " · перепечатка" : ""}
                    </td>
                    <td className="num">{time(i.created_at)}</td>
                    <td className="num">{time(i.sla_due)}</td>
                    <td>
                      <span className="chip status-chip" data-status={i.status}>
                        {IT_STATUS[i.status] || i.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="orders-title">
        <div className="row between wrap">
          <h2 id="orders-title" className="admin-h">
            Заказы
          </h2>
          {isAdmin && (
            <Link className="small" href="/admin/orders">
              Все заказы, поиск и CSV →
            </Link>
          )}
        </div>
        {!orderRows.length ? (
          <p className="muted">Заказов пока нет.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">№</th>
                  <th scope="col" className="num">Сумма</th>
                  <th scope="col">Создан</th>
                  <th scope="col">Оплата</th>
                  <th scope="col">Статус</th>
                </tr>
              </thead>
              <tbody>
                {orderRows.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{isAdmin ? <Link href={`/admin/orders/${o.id}`}>{o.number}</Link> : o.number}</b>
                      {o.is_demo ? <span className="muted small"> · демо</span> : null}
                    </td>
                    <td className="num">{byn(o.total_kop)}</td>
                    <td className="num">{time(o.created_at)}</td>
                    <td>{o.payment_status === "paid_test" ? "оплачен (тест)" : "не оплачен"}</td>
                    <td>
                      <StatusChip status={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
