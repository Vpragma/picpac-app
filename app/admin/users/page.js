// Админка → «Пользователи» (N9, только админ): список, поиск, выдача и снятие ролей модератора и администратора.
// Почта и имя замаскированы. Свои роли, последнего админа, демо-аккаунты и синтетику менять нельзя (проверяет база).
import Link from "next/link";
import UserRoleButtons from "@/components/admin/UserRoleButtons";
import { listUsers, userFilters, userParams } from "@/lib/server/adminUsers";
import { ROLE_LABELS } from "@/lib/roles";
import { requirePageRole } from "@/lib/server/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Пользователи — PicPac" };

const date = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function AdminUsersPage({ searchParams }) {
  const auth = await requirePageRole(["admin"], "/admin/users");
  const parsed = userFilters.safeParse(userParams(await searchParams));
  const f = parsed.success ? parsed.data : {};
  const res = await listUsers(auth, f).catch((e) => {
    console.error(e?.message);
    return null;
  });
  const link = (patch = {}) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...patch })) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return "/admin/users" + (s ? "?" + s : "");
  };
  return (
    <div>
      <h1>Пользователи</h1>
      <p className="muted small">Почта и имя скрыты частично. Найти человека можно по полной почте, части имени или началу id. Выдача и снятие роли записываются в журнал.</p>

      <nav className="filters filters-scroll" aria-label="Роль">
        <Link className={"filter-chip" + (!f.role ? " active" : "")} href={link({ role: undefined, page: undefined })} aria-current={!f.role ? "true" : undefined}>
          Все
        </Link>
        {["admin", "moderator", "client"].map((r) => (
          <Link key={r} className={"filter-chip" + (f.role === r ? " active" : "")} href={link({ role: r, page: undefined })} aria-current={f.role === r ? "true" : undefined}>
            {ROLE_LABELS[r]}
          </Link>
        ))}
      </nav>

      <form method="get" action="/admin/users" className="card" data-testid="users-search">
        <div className="admin-filters">
          <label className="field">
            <span>Почта, имя или id</span>
            <input className="input" name="q" type="search" defaultValue={f.q || ""} maxLength={100} autoComplete="off" spellCheck={false} />
          </label>
          {f.role && <input type="hidden" name="role" value={f.role} />}
          <label className="admin-check">
            <input type="checkbox" name="tests" value="1" defaultChecked={f.tests === "1"} /> Показать тестовые аккаунты
          </label>
          <div className="admin-actions" style={{ marginBottom: 12 }}>
            <button className="btn btn-primary" type="submit">
              Найти
            </button>
            <Link className="btn" href="/admin/users">
              Сбросить
            </Link>
          </div>
        </div>
      </form>

      {!parsed.success && (
        <div className="card" role="alert">
          <b className="err-text">Фильтр не распознан.</b>
          <p className="muted small">{parsed.error.issues[0]?.message}</p>
        </div>
      )}
      {!res && (
        <div className="card" role="alert">
          <b className="err-text">Не получилось загрузить пользователей.</b>
          <p className="muted">Обновите страницу через минуту.</p>
        </div>
      )}
      {res && (
        <>
          <p className="small" aria-live="polite" data-testid="users-summary">
            {res.total ? `Найдено: ${res.total.toLocaleString("ru-RU")}. Сначала сотрудники.` : "Никого не нашли."}
          </p>
          {!!res.items.length && (
            <div className="table-wrap">
              <table className="data-table" data-testid="users-table">
                <thead>
                  <tr>
                    <th scope="col">Пользователь</th>
                    <th scope="col">Роли</th>
                    <th scope="col">Создан</th>
                    <th scope="col">Последний вход</th>
                    <th scope="col">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {res.items.map((u) => (
                    <tr key={u.id} data-user={u.id}>
                      <td className="wrap-any">
                        <b>{u.name || "без имени"}</b>
                        <div className="muted small">
                          {u.email} · id {u.id.slice(0, 8)}
                          {u.isSelf ? " · это вы" : ""}
                          {u.isDemo ? " · демо" : ""}
                          {u.isSynthetic ? " · синтетика" : ""}
                        </div>
                      </td>
                      <td>
                        <span className="roles">
                          {u.roles.map((r) => (
                            <span key={r} className="chip status-chip" data-status={r === "admin" ? "returned" : r === "moderator" ? "moderation" : "done"}>
                              {ROLE_LABELS[r]}
                            </span>
                          ))}
                        </span>
                      </td>
                      <td className="num">{date(u.createdAt)}</td>
                      <td className="num">{date(u.lastSignInAt)}</td>
                      <td>
                        <UserRoleButtons user={u} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.pages > 1 && (
            <nav className="admin-pager" aria-label="Страницы списка пользователей">
              {res.page > 1 && (
                <Link className="btn btn-small" href={link({ page: res.page > 2 ? res.page - 1 : undefined })} rel="prev">
                  ← Назад
                </Link>
              )}
              <span className="muted small">
                {res.page} / {res.pages}
              </span>
              {res.page < res.pages && (
                <Link className="btn btn-small" href={link({ page: res.page + 1 })} rel="next">
                  Дальше →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
