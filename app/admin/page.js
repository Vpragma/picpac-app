// Админка → «Заказы»: последние заказы и обращения клиентов из базы (только чтение, без ФИО и адресов).
// Доступ проверяет сервер: proxy.js и app/admin/layout.js (роль модератора или админа).
// Смена статуса с причиной, очередь модерации и чат оператора — этап S06.
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";
import { StatusChip } from "@/components/OrderBits";

export const dynamic = "force-dynamic";

const time = (iso) =>
  iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const byn = (kop) => (kop / 100).toFixed(2).replace(".", ",") + " BYN";
const IT_STATUS = { open: "Ждёт ответа", answered: "Есть ответ", closed: "Закрыто" };

export default async function AdminPage() {
  await requirePageRole(["moderator", "admin"], "/admin");
  const db = createSupabaseAdmin();
  const [orders, interactions] = await Promise.all([
    db.from("orders").select("id, number, status, total_kop, payment_status, is_demo, created_at").order("created_at", { ascending: false }).limit(30),
    db.from("interactions").select("id, topic, kind, status, sla_due, created_at, orders(number)").order("created_at", { ascending: false }).limit(30),
  ]);
  return (
    <div>
      <h1>Заказы</h1>
      <p className="muted small">Последние 30 заказов и обращений из базы. Смена статуса с причиной, модерация и ответы операторов — следующий этап.</p>
      <section className="card">
        <h3>Обращения</h3>
        {!interactions.data?.length && <p className="muted">Обращений пока нет.</p>}
        {(interactions.data || []).map((i) => (
          <div key={i.id} className="sum-line" style={{ gap: 12 }}>
            <span>
              <b>{i.orders?.number}</b> · {i.topic}
              {i.kind === "reprint" ? " · перепечатка" : ""}
              <span className="muted small"> · {time(i.created_at)}, ответить до {time(i.sla_due)}</span>
            </span>
            <span className="chip">{IT_STATUS[i.status] || i.status}</span>
          </div>
        ))}
      </section>
      <section className="card">
        <h3>Заказы</h3>
        {!orders.data?.length && <p className="muted">Заказов пока нет.</p>}
        {(orders.data || []).map((o) => (
          <div key={o.id} className="sum-line" style={{ gap: 12 }}>
            <span>
              <b>{o.number}</b> · {byn(o.total_kop)}
              <span className="muted small">
                {" "}
                · {time(o.created_at)} · {o.payment_status === "paid_test" ? "оплачен (тест)" : "не оплачен"}
                {o.is_demo ? " · демо" : ""}
              </span>
            </span>
            <StatusChip status={o.status} />
          </div>
        ))}
      </section>
    </div>
  );
}
