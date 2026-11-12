// Админка: вторая линия защиты после proxy.js. Без входа — 401, без роли модератора или админа — 403.
import Link from "next/link";
import { ROLE_LABELS } from "@/lib/roles";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Админка — PicPac" };

export default async function AdminLayout({ children }) {
  const auth = await requirePageRole(["moderator", "admin"], "/admin");
  return (
    <div>
      <div className="row between wrap" style={{ marginBottom: 12 }}>
        <nav className="row wrap" aria-label="Разделы админки">
          <Link href="/admin" className="btn btn-small">
            Обзор
          </Link>
          <Link href="/admin/moderation" className="btn btn-small">
            Модерация
          </Link>
          <Link href="/admin/notifications" className="btn btn-small">
            Уведомления
          </Link>
          {auth.activeRole === "admin" && (
            <Link href="/admin/stats" className="btn btn-small">
              Статистика
            </Link>
          )}
          {auth.activeRole === "admin" && (
            <Link href="/admin/audit" className="btn btn-small">
              Журнал действий
            </Link>
          )}
          {auth.activeRole === "admin" && (
            <Link href="/admin/reminders" className="btn btn-small">
              Напоминания
            </Link>
          )}
          {auth.activeRole === "admin" && (
            <Link href="/admin/push" className="btn btn-small">
              Демо пушей
            </Link>
          )}
        </nav>
        <span className="chip">{ROLE_LABELS[auth.activeRole]}</span>
      </div>
      {children}
    </div>
  );
}
