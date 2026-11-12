// Админка → «Обзор»: последние заказы и обращения клиентов из базы (без ФИО и адресов).
// Доступ проверяет сервер: proxy.js и app/admin/layout.js (роль модератора или админа).
// Админ открывает карточку заказа (смена статуса с причиной) и обращение (чат оператора).
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import Link from "next/link";
import { StatusChip } from "@/components/OrderBits";

export const dynamic = "force-dynamic";

const time = (iso) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const byn = (kop) => (kop / 100).toFixed(2).replace(".", ",") + " BYN";
const IT_STATUS = { open: "Ждёт ответа", answered: "Есть ответ", closed: "Закрыто" };

export default async function AdminPage() {
  const auth = await requirePageRole(["moderator", "admin"], "/admin");
  const isAdmin = auth.activeRole === "admin";
  const db = createSupabaseAdmin();
  const [orders, interactions] = await Promise.all([
    db.from("orders").select("id, number, status, total_kop, payment_status, is_demo, created_at").order("created_at", { ascending: false }).limit(30),
    db.from("interactions").select("id, topic, kind, status, sla_due, created_at, orders(number)").order("created_at", { ascending: false }).limit(30),
  ]);
  const orderRows = orders.data || [];
  const itRows = interactions.data || [];
  const count = (list, f) => list.filter(f).length;
  // Плитки — по тем же последним 30 заказам и обращениям (полная статистика — «Статистика»)
  const tiles = [
    { label: "Ждут модерации", value: count(orderRows, (o) => o.status === "moderation") },
    { label: "В производстве", value: count(orderRows, (o) => o.status === "production") },
    { label: "Обращения без ответа", value: count(itRows, (i) => i.status === "open"), warn: true },
    { label: "Оплачено (тест)", value: count(orderRows, (o) => o.payment_status === "paid_test") },
  ];
  return (
    <div>
      <h1>Обзор</h1>
      <p className="muted small">Последние 30 заказов и обращений из базы.{isAdmin ? " Откройте заказ, чтобы сменить статус, или обращение, чтобы ответить клиенту." : ""}</p>
      <div className="stat-tiles" data-testid="overview-tiles">
        {tiles.map((t) => (
          <div key={t.label} className={"stat-tile" + (t.warn && t.value > 0 ? " warn" : "")}>
            <span className="muted small">{t.label}</span>
            <b>{t.value}</b>
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
                      <span className="status-chip" data-status={i.status}>
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
        <h2 id="orders-title" className="admin-h">Заказы</h2>
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
