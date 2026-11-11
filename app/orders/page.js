"use client";
import Link from "next/link";
import { useStored } from "../../lib/store";
import { money } from "../../lib/price";
import { StatusChip } from "../../components/OrderBits";

export default function OrdersPage() {
  const [orders, , ready] = useStored("orders", []);
  if (!ready) return <p className="muted">Загружаем заказы…</p>;
  return (
    <div>
      <h1>Мои заказы</h1>
      {!orders.length && (
        <div className="card">
          <p>Заказов пока нет.</p>
          <p className="muted">Ваши фотокниги и фото появятся здесь сразу после оформления.</p>
          <Link href="/" className="btn btn-primary">В каталог</Link>
        </div>
      )}
      {orders.map((o) => (
        <Link key={o.id} href={"/orders/" + o.id} className="card" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
          <div className="row between">
            <b style={{ color: "var(--ds-color-text-strong)" }}>№ {o.id}</b>
            <StatusChip status={o.status} />
          </div>
          <div className="muted small">
            {o.items.map((i) => i.name).join(", ")} · {new Date(o.createdAt).toLocaleDateString("ru-RU")}
          </div>
          <b>{money(o.totals.total)}</b>
        </Link>
      ))}
    </div>
  );
}
