"use client";
// Уведомления о заказах на этом устройстве
import { useStored } from "../lib/store";

export default function Notifications() {
  const [notes, , ready] = useStored("notifications", []);
  return (
    <section className="card">
      <h3>Уведомления</h3>
      {ready && !notes.length && <p className="muted">Пока тихо. Здесь появятся новости о ваших заказах.</p>}
      {notes.slice(0, 15).map((n) => (
        <div key={n.id} className="sum-line small">
          <span>{n.text}</span>
          <span className="muted">{new Date(n.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      ))}
    </section>
  );
}
