// Журнал действий (ОТ-04, SEC-15, N9): только для роли admin. Время — по Минску. Журнал только читается.
// N9: по умолчанию — действия людей за 7 дней; системные события, ERP (и симулятор) и автотесты скрыты
// и включаются кнопками «Показать также». Одинаковые события подряд — одной строкой «×N» (раскрывается).
// Быстрые фильтры, постраничный вывод курсором. Всё работает без JS (ссылки и форма method="get").
// Почты в адресе нет: поиск по почте — отдельной формой (POST).
import AuditEmailSearch from "@/components/admin/AuditEmailSearch";
import AuditRow from "@/components/admin/AuditRow";
import { ACTION_LABELS, OBJECT_LABELS, RESULT_LABELS } from "@/lib/auditLabels";
import { AUDIT_PERIODS, AUDIT_QUICK } from "@/lib/auditView";
import { ROLE_LABELS } from "@/lib/roles";
import { auditFilters, filtersFromParams, queryAuditGroups } from "@/lib/server/auditRead";
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
  moderation: "Модерация",
  erp: "ERP",
  ai: "Облачный ИИ",
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
// Кнопка-фильтр (ссылка): выбранная — class active и aria-current (aria-pressed у ссылок не бывает)
const chip = (on) => "filter-chip" + (on ? " active" : "");
// Что можно показать дополнительно (по умолчанию скрыто)
const SHOW = [
  { key: "system", label: "Системные", short: "системные события", hint: "расписание и автоматические уведомления" },
  { key: "erp", label: "ERP и симулятор", short: "ERP и симулятор", hint: "события производства, в том числе симулятора" },
  { key: "tests", label: "Автотесты", short: "автотесты", hint: "служебные тестовые аккаунты (и уже удалённые аккаунты) и запросы с самого сервера" },
];
// Ключи состояния экрана (не фильтры журнала)
const VIEW_KEYS = ["system", "erp", "tests", "page", "sent", "hideTests"];

export default async function AuditPage({ searchParams }) {
  const auth = await requirePageRole(["admin"], "/admin/audit");
  const raw = filtersFromParams(await searchParams);
  const view = {
    system: raw.system === "1",
    erp: raw.erp === "1",
    // совместимость со старыми ссылками: hideTests=0 — показать автотесты
    tests: raw.tests === "1" || raw.hideTests === "0",
    page: Math.min(Math.max(Number.parseInt(raw.page, 10) || 1, 1), 10_000),
  };
  for (const k of VIEW_KEYS) delete raw[k];
  delete raw.limit;
  delete raw.group;
  const parsed = auditFilters.safeParse(raw);
  const f = parsed.success ? parsed.data : {};
  if (!f.days && !f.from && !f.to) f.days = "7";
  // Точные фильтры (форма) — для счётчика «включено»
  const exact = ["action", "result", "role", "from", "to", "objectType", "objectId", "user"].filter((k) => f[k]);

  let groups = [];
  let rows = 0;
  let next = null;
  let failed = false;
  try {
    ({ groups, rows, next } = await queryAuditGroups(
      auth.supabase,
      { ...f, hideTests: view.tests ? undefined : "1", hideSystem: view.system ? undefined : "1", hideErp: view.erp ? undefined : "1" },
      { pageSize: PAGE },
    ));
  } catch (e) {
    console.error(e?.message);
    failed = true;
  }

  // Ссылка на экран с теми же фильтрами + изменения. Смена фильтра — снова первая страница.
  const href = (patch = {}, { keepPage = false } = {}) => {
    const state = { ...f, system: view.system ? "1" : undefined, erp: view.erp ? "1" : undefined, tests: view.tests ? "1" : undefined };
    if (!keepPage) delete state.before;
    Object.assign(state, patch);
    if (state.days === "7" && !state.from && !state.to) delete state.days;
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(state)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const s = p.toString();
    return "/admin/audit" + (s ? "?" + s : "");
  };
  const hidden = SHOW.filter((s) => !view[s.key]).map((s) => s.short);

  return (
    <div>
      <div className="row between wrap">
        <h1>Журнал действий</h1>
        <a href={href({}, { keepPage: false })} className="btn btn-small">
          Обновить
        </a>
      </div>
      <p className="muted small">
        Время — по Минску (UTC+3). Изменить или удалить запись нельзя — так устроена база; лишнее только скрыто на экране.
        {hidden.length ? ` Сейчас скрыто: ${hidden.join(", ")}.` : " Показано всё."}
      </p>

      <nav className="filters filters-scroll" aria-label="Быстрые фильтры журнала" data-testid="audit-quick">
        <a className={chip(!f.quick)} href={href({ quick: undefined })} aria-current={!f.quick ? "true" : undefined}>
          Все действия
        </a>
        {Object.entries(AUDIT_QUICK).map(([k, q]) => (
          <a key={k} className={chip(f.quick === k)} href={href({ quick: k })} aria-current={f.quick === k ? "true" : undefined} title={q.hint} data-testid={`audit-quick-${k}`}>
            {q.label}
          </a>
        ))}
      </nav>
      <div className="row wrap audit-view">
        <nav className="filters filters-scroll" aria-label="Период">
          {Object.entries(AUDIT_PERIODS).map(([d, label]) => (
            <a key={d} className={chip(!f.from && !f.to && f.days === d)} href={href({ days: d, from: undefined, to: undefined })} aria-current={!f.from && !f.to && f.days === d ? "true" : undefined}>
              {label}
            </a>
          ))}
        </nav>
        <nav className="filters filters-scroll" aria-label="Показать также">
          <span className="muted small">Показать также:</span>
          {SHOW.map((s) => (
            <a key={s.key} className={chip(view[s.key])} href={href({ [s.key]: view[s.key] ? undefined : "1" })} aria-current={view[s.key] ? "true" : undefined} title={s.hint} data-testid={`audit-show-${s.key}`}>
              {s.label}
            </a>
          ))}
        </nav>
      </div>

      <details className="card" open={exact.length > 0}>
        <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", alignItems: "center", fontWeight: 500 }}>
          Точные фильтры{exact.length ? ` · включено: ${exact.length}` : ""}
        </summary>
        <form method="get" action="/admin/audit" style={{ marginTop: 12 }}>
          <div className="audit-grid">
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
              <span>Роль</span>
              <select className="input" name="role" defaultValue={f.role || ""}>
                <option value="">Любая</option>
                {Object.entries(ROLE_LABELS).map(([k, v]) => (
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
          {/* состояние экрана сохраняется при поиске */}
          {f.quick && <input type="hidden" name="quick" value={f.quick} />}
          {!f.from && !f.to && f.days !== "7" && <input type="hidden" name="days" value={f.days} />}
          {SHOW.filter((s) => view[s.key]).map((s) => (
            <input key={s.key} type="hidden" name={s.key} value="1" />
          ))}
          <div className="row wrap">
            <button className="btn btn-primary" type="submit">
              Найти
            </button>
            <a className="btn" href="/admin/audit">
              Сбросить всё
            </a>
          </div>
        </form>
      </details>

      <AuditEmailSearch />

      {!parsed.success && (
        <div className="card" role="alert">
          <b className="err-text">Фильтр не распознан — показаны записи без него.</b>
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
        <p className="small" aria-live="polite" data-testid="audit-summary">
          {groups.length
            ? `Страница ${view.page}: строк ${groups.length}, записей ${rows}${groups.some((g) => g.count > 1) ? " (одинаковые подряд — одной строкой «×N»)" : ""}${next ? " · есть ещё" : ""}.`
            : f.quick || exact.length
              ? "По этим фильтрам записей нет."
              : "За этот период действий людей нет. Включите «Показать также» или выберите период длиннее."}
        </p>
      )}
      {groups.map((g) => (
        <AuditRow key={g.items[0].id} item={g.items[0]} group={g.count > 1 ? g.items : null} />
      ))}
      {(next || view.page > 1) && (
        <nav className="row wrap audit-pager" aria-label="Страницы журнала">
          {view.page > 1 && (
            <a className="btn" href={href({ before: undefined, page: undefined })}>
              ← В начало
            </a>
          )}
          {next && (
            <a className="btn btn-primary" href={href({ before: String(next), page: String(view.page + 1) }, { keepPage: true })} data-testid="audit-next">
              Следующая страница →
            </a>
          )}
        </nav>
      )}
    </div>
  );
}
