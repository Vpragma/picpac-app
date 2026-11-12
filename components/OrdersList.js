"use client";
// История заказов (ТЗ п. 8): список из GET /api/v1/orders. Из списка открывается заказ: состав, сумма, статус, обращения.
// Демо-заказы двигаются по статусам сами — список обновляется раз в 15 секунд.
import Link from "next/link";
import { useEffect, useState } from "react";
import { callApi } from "../lib/api";
import { getMe } from "../lib/me";
import { StatusChip, byn, minskDay } from "./OrderBits";
import { EmptyState } from "./LineArt";

const POLL_MS = 15000;

export default function OrdersList() {
  const [res, setRes] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      // Гостю заказы не запрашиваем (нет лишних 401 в консоли) — сразу предлагаем войти
      const m = await getMe();
      const r = m?.authenticated ? await callApi("/api/v1/orders", { method: "GET" }) : { status: m?.unknown ? 0 : 401, ok: false, error: { message: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." } };
      // Без связи оставляем то, что уже показано
      if (alive) setRes((prev) => (r.status === 0 && prev?.ok ? prev : r));
    };
    load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!res) return <p className="muted">Загружаем заказы…</p>;
  if (res.status === 401)
    return (
      <div>
        <h1>Мои заказы</h1>
        <EmptyState
          art="orders"
          title="Заказы — в вашем аккаунте"
          actions={
            <>
              <Link href="/login?next=/orders" className="btn btn-primary">
                Войти
              </Link>
              <Link href="/" className="btn">
                В каталог
              </Link>
            </>
          }
        >
          Войдите, чтобы увидеть историю заказов и следить за каждым шагом — от печати до доставки.
        </EmptyState>
      </div>
    );
  if (res.status === 403)
    return (
      <div>
        <h1>Мои заказы</h1>
        <div className="card stack">
          <p>Заказы видны в роли «Клиент». Сейчас вы вошли как сотрудник или роль не выбрана.</p>
          <a href="/login/role" className="btn btn-primary btn-block">
            Выбрать роль
          </a>
          <Link href="/profile" className="btn btn-block">
            В профиль
          </Link>
        </div>
      </div>
    );
  if (!res.ok)
    return (
      <div>
        <h1>Мои заказы</h1>
        <div className="card" role="alert">
          <p>{res.error?.message || "Не получилось загрузить заказы."}</p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </div>
      </div>
    );
  const orders = res.items || [];
  return (
    <div>
      <h1>Мои заказы</h1>
      {!orders.length && (
        <EmptyState
          art="orders"
          title="Заказов пока нет"
          actions={
            <Link href="/" className="btn btn-primary">
              В каталог
            </Link>
          }
        >
          Здесь появятся ваши фотокниги и фото — сразу после оформления. Будем следить за каждым шагом вместе.
        </EmptyState>
      )}
      {orders.map((o) => (
        <Link key={o.id} href={"/orders/" + o.id} className="card order-row" style={{ display: "block", textDecoration: "none", color: "inherit" }} data-number={o.number}>
          <div className="row between">
            <b style={{ color: "var(--ds-color-text-strong)" }}>№ {o.number}</b>
            <StatusChip status={o.status} />
          </div>
          <div className="muted small">
            {(o.titles || []).join(", ") || `Позиций: ${o.itemsCount}`} · от {minskDay(o.createdAt)}
          </div>
          <div className="row between">
            <b>{byn(o.totalKop)}</b>
            <span className="small" style={{ color: "var(--ds-color-link, inherit)" }}>
              Открыть заказ →
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
