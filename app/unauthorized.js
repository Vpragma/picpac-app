// Страница «401 — нужно войти». Показывается, если открыть закрытый раздел без входа.
import Link from "next/link";
import NextLink from "../components/auth/NextLink";

export default function Unauthorized() {
  return (
    <div className="card stack narrow" style={{ textAlign: "center", marginTop: 24 }}>
      <title>Нужно войти — PicPac</title>
      <div>
        <span className="chip">Ошибка 401</span>
      </div>
      <h1>Нужно войти</h1>
      <p className="muted">Этот раздел открывается только после входа в аккаунт. Каталог, редактор и корзина работают и без входа.</p>
      <NextLink base="/login" className="btn btn-primary btn-block">
        Войти
      </NextLink>
      <Link href="/" className="btn btn-block">
        В каталог
      </Link>
    </div>
  );
}
