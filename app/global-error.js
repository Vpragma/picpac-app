"use client";
// Сбой корневого макета (N-11): своя страница целиком — без общих стилей, поэтому стили здесь же.
import { SUPPORT } from "@/lib/support";

const btn = {
  minHeight: 48, padding: "0 22px", borderRadius: 999, border: 0, font: "inherit", fontWeight: 500, cursor: "pointer",
  background: "linear-gradient(90deg, #e0283a, #d61f69)", color: "#fff",
};

export default function GlobalError({ retry, reset }) {
  const again = retry || reset;
  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif", fontSize: "1rem", lineHeight: 1.5, background: "#faf5ed", color: "#2b403d" }}>
        <title>Ошибка — PicPac</title>
        <main style={{ maxWidth: "32rem", margin: "0 auto", padding: "3rem 1rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.875rem", fontWeight: 500, margin: "0 0 0.5rem" }}>Что-то пошло не так</h1>
          <p>Приложение не загрузилось. Попробуйте ещё раз — черновики и корзина на месте.</p>
          <p>
            <button type="button" style={btn} onClick={() => again?.()}>
              Повторить
            </button>
          </p>
          <p>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- корневой макет сломан: обычная ссылка перезагрузит приложение целиком */}
            <a href="/" style={{ color: "#bd3434", display: "inline-block", padding: "12px 8px" }}>
              На главную
            </a>
          </p>
          <p>
            Поддержка: <a href={SUPPORT.phoneHref} style={{ color: "#bd3434" }}>{SUPPORT.phone}</a>, ежедневно {SUPPORT.hours}
          </p>
        </main>
      </body>
    </html>
  );
}
