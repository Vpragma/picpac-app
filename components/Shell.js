"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconBook, IconCart, IconGrid, IconPackage, IconUser } from "./icons";
import { cartCount, useCart } from "../lib/cart";
import { startSync } from "../lib/sync";
import Pwa from "./Pwa";

const TABS = [
  { href: "/", label: "Каталог", icon: IconGrid, match: (p) => p === "/" || p.startsWith("/product") },
  { href: "/books", label: "Мои книги", icon: IconBook, match: (p) => p.startsWith("/books") || p.startsWith("/editor") },
  { href: "/orders", label: "Заказы", icon: IconPackage, match: (p) => p.startsWith("/orders") },
  { href: "/profile", label: "Профиль", icon: IconUser, match: (p) => p.startsWith("/profile") || p.startsWith("/login") || p.startsWith("/admin") },
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

export default function Shell({ children }) {
  const path = usePathname() || "/";
  const count = cartCount(useCart());
  // Проекты вошедшего клиента синхронизируются с аккаунтом (гость работает только на устройстве)
  useEffect(() => {
    startSync();
  }, []);
  // Старая версия хранила «вход» в localStorage — убираем остатки, вход теперь только на сервере
  useEffect(() => {
    try {
      window.localStorage.removeItem("picpac:session");
    } catch {}
  }, []);
  return (
    <div className="app">
      <header className="topbar">
        <Link href="/" className="logo" aria-label="PicPac — на главную">
          <img src="/logo.svg" alt="PicPac" width="72" height="40" />
        </Link>
        <Link href="/cart" className="cart-btn" aria-label={"Корзина, позиций: " + count}>
          <IconCart />
          {count > 0 && (
            <span className="badge badge-bump" key={count}>
              {count}
            </span>
          )}
        </Link>
      </header>
      <main className="content">{children}</main>
      <nav className="tabbar" aria-label="Главное меню">
        {TABS.map((t) => {
          const active = t.match(path);
          const I = t.icon;
          return (
            <Link key={t.href} href={t.href} className={"tab" + (active ? " active" : "")} aria-current={active ? "page" : undefined}>
              <I size={22} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>
      <Toasts hidden={path.startsWith("/login")} />
      <Pwa />
    </div>
  );
}
