"use client";
// ЧЕРНОВИК: простая админка — заказы этого устройства и ручная смена статуса.
// Доступ проверяется только в браузере, настоящей защиты нет.
import Link from "next/link";
import { useStored } from "../../lib/store";
import { STATUSES, setOrderDemo, setOrderStatus } from "../../lib/orders";
import { money } from "../../lib/price";
import { StatusChip } from "../../components/OrderBits";

export default function AdminPage() {
  const [session, , ready] = useStored("session", null);
  const [orders] = useStored("orders", []);
  if (!ready) return <p className="muted">Загружаем…</p>;
  if (session?.role !== "admin")
    return (
      <div className="card">
        <h2>Только для администратора</h2>
        <p className="muted">Войдите как admin@test и выберите «как администратор».</p>
        <Link href="/login" className="btn btn-primary">Войти</Link>
      </div>
    );
  return (
    <div>
      <h1>Админка</h1>
      <p className="muted">Заказы этого устройства: {orders.length}. Смена статуса сразу видна клиенту и приходит уведомлением.</p>
      {orders.map((o) => (
        <div key={o.id} className="card">
          <div className="row between">
            <Link href={"/orders/" + o.id}><b>№ {o.id}</b></Link>
            <StatusChip status={o.status} />
          </div>
          <div className="muted small">
            {o.items.map((i) => i.name).join(", ")} · {money(o.totals.total)} · {o.delivery.name}
          </div>
          <div className="row wrap" style={{ marginTop: 8 }}>
            <select className="input" style={{ flex: 1, minWidth: 180 }} value={o.status} onChange={(e) => setOrderStatus(o.id, e.target.value, "админ")} aria-label="Статус заказа">
              {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <label className="row small">
              <input type="checkbox" checked={!!o.demo} onChange={(e) => setOrderDemo(o.id, e.target.checked)} /> авто-демо
            </label>
          </div>
        </div>
      ))}
      {!orders.length && <p className="muted">Заказов пока нет — оформите тестовый заказ в каталоге.</p>}
    </div>
  );
}
