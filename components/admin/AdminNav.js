"use client";
// Разделы админки — вкладки-фильтры (N1): активный раздел подсвечен, плотная строка без лишних рамок
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Обзор", match: (p) => p === "/admin" || p.startsWith("/admin/support") },
  { href: "/admin/orders", label: "Заказы", admin: true },
  { href: "/admin/moderation", label: "Модерация" },
  { href: "/admin/notifications", label: "Уведомления" },
  { href: "/admin/stats", label: "Статистика", admin: true },
  { href: "/admin/users", label: "Пользователи", admin: true },
  { href: "/admin/catalog", label: "Каталог", admin: true },
  { href: "/admin/audit", label: "Журнал действий", admin: true },
  { href: "/admin/reminders", label: "Напоминания", admin: true },
  { href: "/admin/push", label: "Демо пушей", admin: true },
];

export default function AdminNav({ isAdmin }) {
  const path = usePathname() || "/admin";
  return (
    <nav className="filters admin-nav" aria-label="Разделы админки">
      {LINKS.filter((l) => !l.admin || isAdmin).map((l) => {
        const active = l.match ? l.match(path) : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className="filter-chip" aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
