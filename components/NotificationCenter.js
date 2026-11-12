"use client";
// Центр уведомлений клиента: только важное — заказ принят, готов и передан в доставку, завершён,
// ответ поддержки, нужно заменить фото. «Прочитать все» и переход к заказу.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../lib/api";
import { minskTime } from "./OrderBits";
import { EmptyState } from "./LineArt";

export default function NotificationCenter({ limit = 50, compact = false }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await callApi(`/api/v1/notifications?limit=${limit}`, { method: "GET" });
    setRes(r);
    if (r.ok) window.dispatchEvent(new CustomEvent("picpac-notifications", { detail: r.unread }));
  }, [limit]);

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

  async function markAll() {
    setBusy(true);
    const r = await callApi("/api/v1/notifications/read", { body: { all: true } });
    setBusy(false);
    if (r.ok) load();
  }

  async function open(n) {
    if (!n.read) await callApi("/api/v1/notifications/read", { body: { ids: [n.id] } });
  }

  if (!res) return <p className="muted">Загружаем уведомления…</p>;
  if (res.status === 401)
    return (
      <p>
        <Link href="/login?next=/notifications">Войдите</Link>, чтобы видеть уведомления о заказах.
      </p>
    );
  if (res.status === 403)
    return (
      <p className="muted small">
        Вы вошли как сотрудник. Лента по заказам — в <Link href="/admin/notifications">админке</Link>.
      </p>
    );
  if (!res.ok) return <p className="error-text">{res.error?.message || "Не получилось загрузить уведомления."}</p>;
  const items = res.items || [];
  return (
    <div className="stack" data-testid="notification-center">
      <div className="row between wrap">
        <span className="muted small">{res.unread ? `Непрочитанных: ${res.unread}` : "Все прочитаны"}</span>
        {res.unread > 0 && (
          <button type="button" className="btn btn-small" onClick={markAll} disabled={busy}>
            {busy ? "Отмечаем…" : "Прочитать все"}
          </button>
        )}
      </div>
      {!items.length && (
        <EmptyState art="bell" title="Пока тихо" headingLevel={2}>
          Здесь появятся новости о ваших заказах: принят, передан в доставку, завершён — и ответы поддержки.
        </EmptyState>
      )}
      {items.slice(0, compact ? 5 : items.length).map((n) => (
        <Link
          key={n.id}
          href={n.link || "/orders"}
          onClick={() => open(n)}
          className="card"
          data-testid="notification"
          data-kind={n.kind}
          data-read={n.read ? "1" : "0"}
          style={{ display: "block", margin: 0, textDecoration: "none", color: "inherit", borderLeft: n.read ? undefined : "4px solid var(--ds-color-accent)" }}
        >
          <div className="row between" style={{ gap: 8 }}>
            <b>{n.title}</b>
            <span className="muted small">{minskTime(n.createdAt)}</span>
          </div>
          <div className="small" style={{ overflowWrap: "anywhere" }}>
            {n.body}
          </div>
          {!n.read && <span className="small" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Не прочитано</span>}
        </Link>
      ))}
    </div>
  );
}
