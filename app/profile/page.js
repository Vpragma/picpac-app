"use client";
import Link from "next/link";
import { useStored, writeKey } from "../../lib/store";

export default function ProfilePage() {
  const [session, , ready] = useStored("session", null);
  const [notes] = useStored("notifications", []);
  if (!ready) return <p className="muted">Загружаем…</p>;
  return (
    <div>
      <h1>Профиль</h1>
      <div className="card">
        {session ? (
          <>
            <b style={{ color: "var(--ds-color-text-strong)" }}>{session.name}</b>
            <div className="muted small">{session.email} · {session.role === "admin" ? "администратор" : "клиент"}</div>
            <div className="row wrap" style={{ marginTop: 12 }}>
              {session.role === "admin" && <Link href="/admin" className="btn btn-small btn-primary">Админка</Link>}
              <button className="btn btn-small" onClick={() => writeKey("session", null)}>Выйти</button>
            </div>
          </>
        ) : (
          <>
            <p>Вы в гостевом режиме. Черновики и заказы хранятся на этом устройстве.</p>
            <Link href="/login" className="btn btn-primary">Войти</Link>
          </>
        )}
      </div>
      <section className="card">
        <h3>Уведомления</h3>
        {!notes.length && <p className="muted">Пока тихо. Здесь появятся новости о ваших заказах.</p>}
        {notes.slice(0, 15).map((n) => (
          <div key={n.id} className="sum-line small">
            <span>{n.text}</span>
            <span className="muted">{new Date(n.at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
        ))}
      </section>
      <section className="card">
        <h3>Поддержка</h3>
        <p className="small">support@picpac.by · +375 44 539-67-89, ежедневно 9:00–21:00</p>
      </section>
    </div>
  );
}
