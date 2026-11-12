// Страница «403 — нет доступа». Показывается, если у выбранной роли нет прав на раздел.
import Link from "next/link";
import NextLink from "../components/auth/NextLink";

export default function Forbidden() {
  return (
    <div className="card stack" style={{ textAlign: "center", marginTop: 24 }}>
      <title>Нет доступа — PicPac</title>
      <div>
        <span className="chip">Ошибка 403</span>
      </div>
      <h1>Нет доступа</h1>
      <p className="muted">
        Этот раздел — для сотрудников PicPac, и у вашей роли нет прав на него. Попытка записана в журнал действий.
      </p>
      <p className="muted small">Если у вашего аккаунта есть роль сотрудника, смените роль.</p>
      <NextLink base="/login/role" className="btn btn-primary btn-block">
        Сменить роль
      </NextLink>
      <Link href="/" className="btn btn-block">
        В каталог
      </Link>
    </div>
  );
}
