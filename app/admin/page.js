"use client";
// Админка: заказы этого устройства и ручная смена статуса.
// Доступ проверяет сервер: proxy.js и app/admin/layout.js (роль модератора или админа).
import Link from "next/link";
import { useStored } from "../../lib/store";
import { STATUSES, setOrderDemo, setOrderStatus } from "../../lib/orders";
import { money } from "../../lib/price";
import { StatusChip } from "../../components/OrderBits";

export default function AdminPage() {
  const [orders, , ready] = useStored("orders", []);
  if (!ready) return <p className="muted">Загружаем…</p>;
  return (
    <div>
      <h1>Заказы</h1>
      <p className="muted">Заказы этого устройства: {orders.length}. Смена статуса сразу видна клиенту и приходит уведомлением.</p>
      {orders.map((o) => (
        <div key={o.id} className="card">
          <div className="row between">
            <Link href={"/orders/" + o.id}><b>№ {o.id}</b></Link>
            <StatusChip status={o.status} />
          </div>
          <div className="muted small">
            {o.items.map((i) => i.name).join(", ")} · {money(o.totals.total)} · {o.delivery.name}
            {o.userId ? ` · аккаунт ${o.userId.slice(0, 8)}…` : ""}
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
