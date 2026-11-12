// Админка → карточка заказа (только админ). Данные клиента замаскированы (SEC-14), лента с настоящими причинами,
// ручная смена статуса с обязательной причиной. Читаем сервисным ключом после проверки роли.
import Link from "next/link";
import { notFound } from "next/navigation";
import OrderStatusForm from "@/components/admin/OrderStatusForm";
import { StatusChip } from "@/components/OrderBits";
import { EVENT_LABELS, progressFor } from "@/lib/erp";
import { maskClient } from "@/lib/mask";
import { STATUS_LABELS } from "@/lib/server/orders";
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const SOURCE = { erp: "ERP", admin: "сотрудник", system: "система" };

export default async function AdminOrderPage({ params }) {
  const { id } = await params;
  await requirePageRole(["admin"], `/admin/orders/${id}`);
  if (!UUID_RE.test(id)) notFound();
  const db = createSupabaseAdmin();
  const { data: o } = await db
    .from("orders")
    .select("id, number, status, substatus, erp_stage, recipient, delivery_code, delivery_address, total_kop, payment_status, is_demo, is_synthetic, created_at, eta_from, eta_to")
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const [{ data: history }, { data: items }, { data: interactions }] = await Promise.all([
    db.from("order_status_history").select("id, status, substatus, at, source, reason, event_type").eq("order_id", id).order("at").order("id"),
    db.from("order_items").select("id, title, quantity, snapshot").eq("order_id", id),
    db.from("interactions").select("id, topic, status, created_at").eq("order_id", id).order("created_at"),
  ]);
  const client = maskClient(o, "admin");
  return (
    <div>
      <Link href="/admin" className="back-link">
        ← Обзор
      </Link>
      <div className="row between wrap" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>№ {o.number}</h1>
        <StatusChip status={o.status} />
      </div>
      <p className="muted small">
        {o.substatus || STATUS_LABELS[o.status]} · готовность {progressFor(o.status, o.erp_stage)} % · {o.payment_status === "paid_test" ? "оплачен (тест)" : "не оплачен"}
        {o.is_demo ? " · демо" : ""}
        {o.is_synthetic ? " · синтетика" : ""}
      </p>

      <section className="card">
        <h3>Сменить статус вручную</h3>
        <OrderStatusForm orderId={o.id} current={o.status} />
      </section>

      <section className="card">
        <h3>Лента статусов</h3>
        <ol className="stack small" style={{ paddingLeft: 18, margin: 0 }} data-testid="admin-history">
          {(history || []).map((h) => (
            <li key={h.id}>
              <b>{STATUS_LABELS[h.status]}</b>
              {h.substatus ? ` · ${h.substatus}` : ""} <span className="muted">· {time(h.at)} · {SOURCE[h.source] || h.source}</span>
              {h.event_type ? <span className="muted"> · {EVENT_LABELS[h.event_type] || h.event_type}</span> : null}
              {h.reason ? <div style={{ overflowWrap: "anywhere" }}>Причина: {h.reason}</div> : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h3>Клиент (данные скрыты)</h3>
        <p className="small" style={{ margin: 0 }} data-testid="masked-client">
          {client.name || "—"} · {client.phone || "—"} · {client.email || "—"}
          {client.address ? ` · ${client.address}` : ""}
        </p>
        <p className="muted small">Полные контакты и адрес видит только служба доставки. Скрыто по правилу SEC-14.</p>
      </section>

      <section className="card">
        <h3>Состав</h3>
        {(items || []).map((i) => (
          <div key={i.id} className="sum-line small">
            <span>
              {i.title}
              {i.quantity > 1 ? ` × ${i.quantity}` : ""}
            </span>
            <span className="muted">{i.snapshot?.photoCount ?? (i.snapshot?.photos || []).length} фото</span>
          </div>
        ))}
      </section>

      {!!interactions?.length && (
        <section className="card">
          <h3>Обращения</h3>
          {interactions.map((it) => (
            <div key={it.id} className="sum-line small">
              <Link href={`/admin/support/${it.id}`}>{it.topic}</Link>
              <span className="muted">{time(it.created_at)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
