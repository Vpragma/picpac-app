"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconBell, IconBook, IconCart, IconCheck, IconGrid, IconHelp, IconImage, IconPackage, IconUser } from "./icons";
import { useMe } from "../lib/me";
import { SUPPORT } from "../lib/support";
import { cartCount, useCart } from "../lib/cart";
import { startSync } from "../lib/sync";
import { syncLargeTextFromCookie } from "../lib/textSize";
import { syncThemeFromCookie } from "../lib/theme";
import Pwa from "./Pwa";
import NotificationBell from "./NotificationBell";

const TABS = [
  { href: "/", label: "Каталог", icon: IconGrid, match: (p) => p === "/" || p.startsWith("/product") },
  { href: "/books", label: "Мои книги", icon: IconBook, match: (p) => p.startsWith("/books") || p.startsWith("/editor") },
  { href: "/orders", label: "Заказы", icon: IconPackage, match: (p) => p.startsWith("/orders") },
  { href: "/profile", label: "Профиль", icon: IconUser, match: (p) => p.startsWith("/profile") || p.startsWith("/login") || p.startsWith("/admin") },
  // На телефоне «Помощь» — значок «?» в шапке; на компьютере ещё и пункт бокового меню
  { href: "/help", label: "Помощь", icon: IconHelp, match: (p) => p.startsWith("/help"), desktopOnly: true },
];

// hidden — на экране входа тосты не показываем: они закрывали бы текст «Войдите или зарегистрируйтесь…» на телефоне
function Toasts({ hidden = false }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const on = (e) => {
      const id = Date.now() + Math.random();
      setItems((list) => [...list, { id, ...e.detail }]);
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4500);
    };
    window.addEventListener("picpac-toast", on);
    return () => window.removeEventListener("picpac-toast", on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {!hidden &&
        items.map((t) => (
        <div key={t.id} className={"toast toast-" + t.kind}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// В роли сотрудника внизу — разделы админки, а не клиентское меню (каталог, книги, заказы клиента)
const STAFF_TABS = [
  { href: "/admin", label: "Обзор", icon: IconPackage, match: (p) => p === "/admin" || p.startsWith("/admin/orders") || p.startsWith("/admin/support") },
  { href: "/admin/moderation", label: "Модерация", icon: IconImage, match: (p) => p.startsWith("/admin/moderation") },
  { href: "/admin/notifications", label: "Уведомления", icon: IconBell, match: (p) => p.startsWith("/admin/notifications") },
  { href: "/admin/stats", label: "Статистика", icon: IconCheck, match: (p) => /^\/admin\/(stats|audit|reminders|users|catalog)(\/|$)/.test(p), adminOnly: true },
  { href: "/profile", label: "Профиль", icon: IconUser, match: (p) => p.startsWith("/profile") || p.startsWith("/login") },
];

// logo — картинка логотипа, собранная на сервере (getImageProps в app/layout.js): без лишнего JS в браузере
export default function Shell({ children, logo, phoneQr = null }) {
  const path = usePathname() || "/";
  const count = cartCount(useCart());
  const me = useMe();
  const staffRole = me?.authenticated && (me.activeRole === "admin" || me.activeRole === "moderator") ? me.activeRole : null;
  const tabs = staffRole ? STAFF_TABS.filter((t) => !t.adminOnly || staffRole === "admin") : TABS;
  // Проекты вошедшего клиента синхронизируются с аккаунтом (гость работает только на устройстве)
  useEffect(() => {
    startSync();
    syncLargeTextFromCookie();
    syncThemeFromCookie();
  }, []);
  // Старая версия хранила «вход» в localStorage — убираем остатки, вход теперь только на сервере
  useEffect(() => {
    try {
      window.localStorage.removeItem("picpac:session");
    } catch {}
  }, []);
  return (
    <div className="app">
      <a href="#main" className="skip-link">
        Перейти к содержимому
      </a>
      <header className="topbar">
        <Link href="/" className="logo" aria-label="PicPac — на главную">
          {logo}
        </Link>
        <div className="topbar-actions">
          <Link href="/help" className="help-btn" aria-label="Помощь" aria-current={path.startsWith("/help") ? "page" : undefined}>
            <IconHelp />
          </Link>
          <NotificationBell />
          <Link href="/cart" className="cart-btn" aria-label={"Корзина, позиций: " + count}>
            <IconCart />
            {count > 0 && (
              <span className="badge badge-bump" key={count}>
                {count}
              </span>
            )}
          </Link>
        </div>
      </header>
      <nav className="tabbar" aria-label={staffRole ? "Меню админки" : "Главное меню"}>
        {tabs.map((t) => {
          const active = t.match(path);
          const I = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={"tab" + (active ? " active" : "") + (t.desktopOnly ? " tab-desktop" : "")}
              aria-current={active ? "page" : undefined}
            >
              <I size={22} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
      <main id="main" tabIndex={-1} className="content">
        {children}
      </main>
      <footer className="site-footer">
        <nav aria-label="Поддержка">
          <Link href="/help">Помощь</Link>
          <a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a>
          <a href={SUPPORT.emailHref}>{SUPPORT.email}</a>
          <Link href="/licenses">Лицензии и авторы</Link>
        </nav>
        <p>Поддержка ежедневно {SUPPORT.hours}</p>
        {phoneQr}
      </footer>
      <Toasts hidden={path.startsWith("/login")} />
      <Pwa />
    </div>
  );
}
