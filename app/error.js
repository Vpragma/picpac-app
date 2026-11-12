"use client";
// Ошибка страницы (N-11): по-русски, «Повторить», «На главную» и телефон поддержки вместо английского «Application error».
import Link from "next/link";
import { SUPPORT } from "@/lib/support";

export default function PageError({ retry, reset }) {
  const again = retry || reset;
  return (
    <div className="card narrow stack" style={{ textAlign: "center", marginTop: 24 }}>
      <title>Ошибка — PicPac</title>
      <h1>Что-то пошло не так</h1>
      <p className="muted">Страница не открылась. Попробуйте ещё раз — черновики и корзина на месте.</p>
      <button type="button" className="btn btn-primary btn-block" onClick={() => again?.()}>
        Повторить
      </button>
      <Link href="/" className="btn btn-block">
        На главную
      </Link>
      <p className="small" style={{ margin: 0 }}>
        Не получается? Позвоните: <a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a>, ежедневно {SUPPORT.hours}.
      </p>
    </div>
  );
}
