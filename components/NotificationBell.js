"use client";
// Значок уведомлений в шапке (только вошедшему клиенту): число непрочитанных из центра уведомлений.
// Опрос раз в 45 с и при возвращении на вкладку. Личных данных в HTML нет — только запрос с устройства.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { IconBell } from "./icons";
import { callApi } from "../lib/api";
import { getMe } from "../lib/me";

const POLL_MS = 45000;

export default function NotificationBell() {
  const path = usePathname() || "/";
  const [unread, setUnread] = useState(null); // null — не клиент или не вошёл: значок не показываем

  useEffect(() => {
    let alive = true;
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      const m = await getMe();
      if (!alive) return;
      if (!m?.authenticated || m.activeRole !== "client") return setUnread(null);
      const r = await callApi("/api/v1/notifications?limit=1", { method: "GET" });
      if (alive && r.ok) setUnread(r.unread);
    };
    check();
    const t = setInterval(check, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && check();
    const onRead = (e) => setUnread(typeof e.detail === "number" ? e.detail : 0);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("picpac-notifications", onRead);
    return () => {
      alive = false;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("picpac-notifications", onRead);
    };
  }, [path]);

  if (unread === null) return null;
  return (
    <Link href="/notifications" className="cart-btn" aria-label={unread ? `Уведомления, непрочитанных: ${unread}` : "Уведомления"} data-testid="notification-bell">
      <IconBell />
      {unread > 0 && <span className="badge">{unread > 99 ? "99+" : unread}</span>}
    </Link>
  );
}
