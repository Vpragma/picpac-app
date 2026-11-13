// Разделы админки и «текущий раздел» по адресу — один источник для вкладок вверху (components/admin/AdminNav.js)
// и меню сотрудника (боковое на компьютере, нижнее на телефоне — components/Shell.js).
// N7: подсвечен только раздел, в котором человек сейчас: на «Журнале» — «Журнал действий», на «Заказах» — «Заказы»
// (раньше в меню сотрудника «Статистика» горела на журнале, каталоге и пользователях, «Обзор» — на заказах).

export const ADMIN_SECTIONS = [
  // Чат обращения (/admin/support/…) открывают из «Обзора» — это его страница
  { href: "/admin", label: "Обзор", also: ["/admin/support"] },
  { href: "/admin/orders", label: "Заказы", admin: true },
  { href: "/admin/moderation", label: "Модерация" },
  { href: "/admin/notifications", label: "Уведомления" },
  { href: "/admin/stats", label: "Статистика", admin: true },
  { href: "/admin/promo", label: "Промокоды", admin: true },
  { href: "/admin/users", label: "Пользователи", admin: true },
  { href: "/admin/catalog", label: "Каталог", admin: true },
  { href: "/admin/audit", label: "Журнал действий", admin: true },
  { href: "/admin/reminders", label: "Напоминания", admin: true },
  { href: "/admin/push", label: "Демо пушей", admin: true },
  { href: "/admin/season", label: "Сезон", admin: true },
];

// Адрес совпадает с разделом целиком или его подстраницей: «/admin/push» — да, «/admin/push-x» — нет
const under = (path, base) => path === base || path.startsWith(base + "/");

// Текущий раздел админки для адреса (href раздела) или null, если адрес не из админки
export function adminSectionOf(path) {
  const p = String(path || "").split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (!under(p, "/admin")) return null;
  let best = null;
  for (const s of ADMIN_SECTIONS) {
    for (const base of [s.href, ...(s.also || [])]) {
      if (s.href === "/admin" && base === "/admin" ? p === "/admin" : under(p, base)) {
        if (!best || base.length > best.len) best = { href: s.href, len: base.length };
      }
    }
  }
  return best?.href || null;
}
