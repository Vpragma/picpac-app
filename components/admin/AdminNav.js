"use client";
// Разделы админки — вкладки-фильтры (N1): подсвечен только текущий раздел (N7: правило — lib/adminNav.js,
// то же, что у меню сотрудника), плотная строка без лишних рамок
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_SECTIONS, adminSectionOf } from "@/lib/adminNav";

export default function AdminNav({ isAdmin }) {
  const current = adminSectionOf(usePathname() || "/admin");
  return (
    <nav className="filters admin-nav" aria-label="Разделы админки">
      {ADMIN_SECTIONS.filter((l) => !l.admin || isAdmin).map((l) => {
        const active = l.href === current;
        return (
          <Link key={l.href} href={l.href} className="filter-chip" aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
