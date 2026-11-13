"use client";
// Ошибка страницы (N-11): по-русски, «Повторить», «На главную» и телефон поддержки вместо английского «Application error».
import Link from "next/link";
import { SUPPORT } from "@/lib/support";
import { isChunkError } from "@/lib/chunkError";

export default function PageError({ error, retry, reset }) {
  const again = retry || reset;
  // N7: кусок кода не скачался (нет сети) — понятный текст; «Повторить» с сетью открывает страницу заново
  const offline = isChunkError(error);
  const onRetry = () => (offline && navigator.onLine ? window.location.reload() : again?.());
  return (
    <div className="card narrow stack" style={{ textAlign: "center", marginTop: 24 }}>
      <title>{offline ? "Нет сети — PicPac" : "Ошибка — PicPac"}</title>
      <h1>{offline ? "Нет сети" : "Что-то пошло не так"}</h1>
      <p className="muted">
        {offline
          ? "Без сети этот экран пока недоступен — откройте его, когда появится связь. Черновики и корзина на месте."
          : "Страница не открылась. Попробуйте ещё раз — черновики и корзина на месте."}
      </p>
      <button type="button" className="btn btn-primary btn-block" onClick={onRetry}>
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
