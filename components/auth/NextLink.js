"use client";
// Ссылка, которая после входа или смены роли вернёт на текущую страницу
import Link from "next/link";
import { usePathname } from "next/navigation";

export default function NextLink({ base, className, children }) {
  const path = usePathname() || "/";
  return (
    <Link href={`${base}?next=${encodeURIComponent(path)}`} className={className}>
      {children}
    </Link>
  );
}
