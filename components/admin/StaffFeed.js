"use client";
// Лента сотрудника: новые заказы, смены статусов, обращения клиентов (админ) или модерация (модератор).
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../../lib/api";
import { minskTime } from "../OrderBits";

export default function StaffFeed() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setRes(await callApi("/api/v1/admin/notifications", { method: "GET" })), []);
  useEffect(() => {
    let alive = true;
    const tick = () => alive && load();
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load]);

  async function seen() {
    setBusy(true);
    await callApi("/api/v1/admin/notifications", { body: {} });
    setBusy(false);
    load();
  }

  if (!res) return <p className="muted">Загружаем…</p>;
  if (!res.ok) return <p className="error-text">{res.error?.message || "Не получилось загрузить ленту."}</p>;
  return (
    <div className="stack" data-testid="staff-feed">
      <div className="row between wrap">
        <span className="muted small">{res.unread ? `Новых: ${res.unread}` : "Новых нет"}</span>
        {res.unread > 0 && (
          <button type="button" className="btn btn-small" onClick={seen} disabled={busy}>
            Прочитать все
          </button>
        )}
      </div>
      {!res.items.length && <p className="muted">Пока пусто.</p>}
      {res.items.map((n) => (
        <div key={n.id} className="card" style={{ margin: 0, borderLeft: n.unread ? "4px solid var(--ds-color-accent)" : undefined }} data-kind={n.kind}>
          <div className="row between" style={{ gap: 8 }}>
            {n.link ? <Link href={n.link}>{n.title}</Link> : <b>{n.title}</b>}
            <span className="muted small">{minskTime(n.createdAt)}</span>
          </div>
          {n.body && (
            <div className="small" style={{ overflowWrap: "anywhere" }}>
              {n.body}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
