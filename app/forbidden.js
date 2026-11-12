// Страница «403 — нет доступа». Показывается, если у выбранной роли нет прав на раздел.
// Модератору (A3) — прямо: раздел только для администратора, и куда ему можно.
import Link from "next/link";
import NextLink from "../components/auth/NextLink";
import { getAuth } from "../lib/server/session";

export default async function Forbidden() {
  let moderator = false;
  try {
    moderator = (await getAuth()).activeRole === "moderator";
  } catch {
    moderator = false;
  }
  if (moderator)
    return (
      <div className="card stack" style={{ textAlign: "center", marginTop: 24 }}>
        <title>Раздел только для администратора — PicPac</title>
        <div>
          <span className="chip">Ошибка 403</span>
        </div>
        <h1>Раздел доступен только администратору</h1>
        <p className="muted">У роли «Модератор» есть «Обзор», «Модерация» и «Уведомления». Попытка записана в журнал действий.</p>
        <Link href="/admin/moderation" className="btn btn-primary btn-block">
          К модерации
        </Link>
        <Link href="/admin" className="btn btn-block">
          В обзор
        </Link>
      </div>
    );
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
