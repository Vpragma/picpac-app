"use client";
// Уведомления в профиле: последние 5 из центра уведомлений (сервер) и ссылка на весь список
import Link from "next/link";
import NotificationCenter from "./NotificationCenter";

export default function Notifications() {
  return (
    <section className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Уведомления</h3>
        <Link href="/notifications" className="small">
          Все уведомления
        </Link>
      </div>
      <NotificationCenter limit={5} compact />
    </section>
  );
}
