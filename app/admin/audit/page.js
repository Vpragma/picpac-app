// Журнал действий (ОТ-04, SEC-15): фильтры и «Показать ещё», только для роли admin. Время — по Минску.
// Форма фильтров работает без JS (method="get"). Почты в адресе нет: поиск по почте — отдельной формой (POST).
import AuditEmailSearch from "@/components/admin/AuditEmailSearch";
import AuditRow from "@/components/admin/AuditRow";
import { ACTION_LABELS, OBJECT_LABELS, RESULT_LABELS } from "@/lib/auditLabels";
import { auditFilters, filtersFromParams, queryAudit } from "@/lib/server/auditRead";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Журнал действий — PicPac" };

const GROUP_LABELS = {
  auth: "Вход и роли",
  access: "Доступ",
  profile: "Профиль",
  account: "Аккаунт",
  project: "Проекты",
  check: "Проверка фото",
  photo: "Фото",
  cart: "Корзина",
  promo: "Промокоды",
  order: "Заказы",
  interaction: "Обращения",
  push: "Пуш-подписки",
  notify: "Уведомления",
  cron: "Расписание",
  admin: "Админ",
};

// Группы и действия из подписей журнала: <optgroup> «группа» → «все действия группы» + каждое действие
function actionGroups() {
  const groups = new Map();
  for (const key of Object.keys(ACTION_LABELS)) {
    const g = key.split(".")[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(key);
  }
  return [...groups.entries()];
}

const PAGE = 50;

export default async function AuditPage({ searchParams }) {
  const auth = await requirePageRole(["admin"], "/admin/audit");
  const raw = filtersFromParams(await searchParams);
  const parsed = auditFilters.safeParse(raw);
  const f = parsed.success ? parsed.data : {};
  const active = Object.keys(f).filter((k) => k !== "before" && k !== "limit");

  let items = [];
  let next = null;
  let failed = false;
  try {
    ({ items, next } = await queryAudit(auth.supabase, { limit: PAGE, ...f }));
  } catch (e) {
    console.error(e?.message);
    failed = true;
  }

  // Ссылка «Показать ещё»: те же фильтры + курсор
  const more = new URLSearchParams();
  for (const k of active) more.set(k, String(f[k]));
  if (next) more.set("before", String(next));

  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "0 12px" };

  return (
    <div>
      <div className="row between wrap">
        <h1>Журнал действий</h1>
        <a href="/admin/audit" className="btn btn-small">
          Обновить
        </a>
      </div>
      <p className="muted">Время — по Минску (UTC+3). Изменить или удалить запись нельзя — так устроена база.</p>

      <details className="card" open={active.length > 0 || !parsed.success}>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 500 }}>
          Фильтры{active.length ? ` · включено: ${active.length}` : ""}
        </summary>
        <form method="get" action="/admin/audit" style={{ marginTop: 12 }}>
          <div style={grid}>
            <label className="field">
              <span>Действие</span>
              <select className="input" name="action" defaultValue={f.action || ""}>
                <option value="">Все действия</option>
                {actionGroups().map(([g, keys]) => (
                  <optgroup key={g} label={GROUP_LABELS[g] || g}>
                    <option value={`${g}.*`}>{GROUP_LABELS[g] || g}: все</option>
                    {keys.map((k) => (
                      <option key={k} value={k}>
                        {ACTION_LABELS[k]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Результат</span>
              <select className="input" name="result" defaultValue={f.result || ""}>
                <option value="">Любой</option>
                {Object.entries(RESULT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>С (дата по Минску)</span>
              <input className="input" type="date" name="from" defaultValue={f.from || ""} />
            </label>
            <label className="field">
              <span>По (включительно)</span>
              <input className="input" type="date" name="to" defaultValue={f.to || ""} />
            </label>
            <label className="field">
              <span>Тип объекта</span>
              <select className="input" name="objectType" defaultValue={f.objectType || ""}>
                <option value="">Любой</option>
                {Object.entries(OBJECT_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Id объекта</span>
              <input className="input" name="objectId" maxLength={200} defaultValue={f.objectId || ""} placeholder="например, PP-261112-10023" />
            </label>
            <label className="field">
              <span>Пользователь (id или 8 знаков)</span>
              <input className="input" name="user" maxLength={36} defaultValue={f.user || ""} autoComplete="off" spellCheck={false} />
            </label>
          </div>
          <div className="row wrap">
            <button className="btn btn-primary" type="submit">
              Найти
            </button>
            <a className="btn" href="/admin/audit">
              Сбросить
            </a>
          </div>
        </form>
      </details>

      <AuditEmailSearch />

      {!parsed.success && (
        <div className="card" role="alert">
          <b className="err-text">Фильтр не распознан — показаны все записи.</b>
          <p className="muted small">{parsed.error.issues[0]?.message}</p>
        </div>
      )}
      {failed && (
        <div className="card" role="alert">
          <b className="err-text">Не получилось загрузить журнал.</b>
          <p className="muted">Обновите страницу через минуту.</p>
        </div>
      )}
      {!failed && (
        <p className="small" aria-live="polite">
          {items.length ? `Показано записей: ${items.length}${next ? " (есть ещё)" : ""}` : active.length ? "По этим фильтрам записей нет." : "Записей пока нет."}
        </p>
      )}
      {items.map((item) => (
        <AuditRow key={item.id} item={item} />
      ))}
      {next && (
        <a className="btn" href={`/admin/audit?${more.toString()}`}>
          Показать ещё
        </a>
      )}
    </div>
  );
}
