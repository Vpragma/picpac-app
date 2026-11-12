// Админка → «Статистика»: плитки, воронка «просмотр → оплачено (тест)», время на шагах редактора, ИИ-редактор.
// Только для роли admin. Числа считает база (analytics_summary), проценты и медианы — lib/analyticsCore.js.
// Формула каждой метрики — в подсказке «?» рядом (ОТ-07) и в README, раздел «Формулы статистики».
import Link from "next/link";
import { fmtDuration } from "@/lib/analyticsCore";
import { requirePageRole } from "@/lib/server/session";
import { loadStats, parseStatsQuery } from "@/lib/server/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Статистика — PicPac" };

const byn = (kop) => (Math.round(kop || 0) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " BYN";
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("ru-RU"));
const p = (v) => (v == null ? "—" : String(v).replace(".", ",") + "%");

function Formula({ children }) {
  return (
    <details className="formula">
      <summary aria-label="Как считается">?</summary>
      <p className="small">{children}</p>
    </details>
  );
}

function Tile({ label, value, sub, formula, warn }) {
  return (
    <div className={"stat-tile" + (warn ? " warn" : "")}>
      <div className="row between" style={{ alignItems: "flex-start" }}>
        <span className="muted small">{label}</span>
        <Formula>{formula}</Formula>
      </div>
      <b>{value}</b>
      {sub && <span className="muted small">{sub}</span>}
    </div>
  );
}

export default async function StatsPage({ searchParams }) {
  await requirePageRole(["admin"], "/admin/stats");
  const q = parseStatsQuery(await searchParams);
  let s = null;
  let failed = false;
  try {
    s = await loadStats(q);
  } catch (e) {
    console.error(e?.message);
    failed = true;
  }
  const link = (patch) => {
    const next = { ...q, ...patch };
    return `/admin/stats?days=${next.days}&source=${next.source}`;
  };
  return (
    <div>
      <div className="row between wrap">
        <h1 style={{ margin: 0 }}>Статистика</h1>
        {s && <span className={"chip" + (s.label === "демо-данные" ? " chip-hl" : " chip-ok")}>{s.label}</span>}
      </div>
      <nav className="row wrap stat-filters" aria-label="Период и источник">
        {[7, 30].map((d) => (
          <Link key={d} href={link({ days: d })} className={"btn btn-small" + (q.days === d ? " btn-primary" : "")} aria-current={q.days === d ? "true" : undefined}>
            {d} дней
          </Link>
        ))}
        <Link href={link({ source: "all" })} className={"btn btn-small" + (q.source === "all" ? " btn-primary" : "")} aria-current={q.source === "all" ? "true" : undefined}>
          Все данные
        </Link>
        <Link href={link({ source: "real" })} className={"btn btn-small" + (q.source === "real" ? " btn-primary" : "")} aria-current={q.source === "real" ? "true" : undefined}>
          Только реальные
        </Link>
      </nav>
      {failed && <p className="card">Не получилось посчитать статистику. Обновите страницу через минуту.</p>}
      {s && (
        <>
          <p className="muted small">
            {s.label === "демо-данные"
              ? `В расчёте есть демо-данные: синтетических событий ${num(s.synthetic.events)}, синтетических заказов ${num(s.synthetic.orders)}. «Только реальные» — без них (заказы и события из приложения остаются).`
              : "Только реальные данные: синтетические строки исключены."}{" "}
            Период — последние {s.days} дней, время по Минску.
          </p>

          <section className="stat-tiles" aria-label="Коротко">
            <Tile label="Заказы сегодня" value={num(s.tiles.ordersToday)} formula="Заказы, созданные с 00:00 сегодняшнего дня по Минску." />
            <Tile label="В работе" value={num(s.tiles.inWork)} formula="Заказы в статусах «Принят», «Модерация» и «Производство» сейчас." />
            <Tile label="Просрочено" value={num(s.tiles.overdue)} warn={s.tiles.overdue > 0} formula="Заказы не в статусах «Готов / передан в доставку» и «Завершён», у которых крайний срок готовности (eta_to) уже прошёл." />
            <Tile label="На модерации" value={num(s.tiles.onModeration)} formula="Заказы в статусе «Модерация» сейчас." />
            <Tile label="Обращения без ответа" value={num(s.tiles.unanswered)} sub={s.tiles.unansweredOverdue ? `${num(s.tiles.unansweredOverdue)} — срок ответа прошёл` : "все в срок"} warn={s.tiles.unansweredOverdue > 0} formula="Обращения в статусе «Ждёт ответа». «После SLA» — срок ответа (sla_due) уже прошёл." />
            <Tile label={`Выручка (тест) за ${s.days} дн.`} value={byn(s.tiles.revenueKop)} formula={`Сумма «Итого» заказов с тестовой оплатой, оплаченных за последние ${s.days} дней (по paid_at). Деньги не списывались. Оплаченных заказов: ${num(s.tiles.paidPeriod)}, всего заказов за период: ${num(s.tiles.ordersPeriod)}.`} />
          </section>

          <section className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>Из добавивших в корзину оплатили</h2>
              <Formula>Оплатили (тест) ÷ добавили в корзину × 100%. Оба числа — разные участники за период: хеш пользователя после входа, иначе сеанс гостя (новый каждый день).</Formula>
            </div>
            <p className="stat-big">{p(s.funnel.cartToPaid)}</p>
            <p className="muted small">
              {num(s.funnel.steps[4].n)} из {num(s.funnel.steps[2].n)} участников за {s.days} дней.
            </p>
          </section>

          <section className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>Воронка</h2>
              <Formula>Шаг — число разных участников с событием шага за период. «От предыдущего» = шаг ÷ предыдущий шаг × 100%. Ширина полосы — доля от просмотров продукта.</Formula>
            </div>
            <ol className="funnel">
              {s.funnel.steps.map((st, i) => (
                <li key={st.key}>
                  <div className="row between">
                    <span>
                      {st.label} <Formula>{st.formula}.</Formula>
                    </span>
                    <b>{num(st.n)}</b>
                  </div>
                  <div className="funnel-bar" aria-hidden="true">
                    <span style={{ width: `${Math.max(2, st.fromFirst || 0)}%` }} />
                  </div>
                  {i > 0 && <span className="muted small">от предыдущего шага: {p(st.fromPrev)}</span>}
                </li>
              ))}
            </ol>
          </section>

          <section className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>Время на шагах редактора</h2>
              <Formula>Медиана времени на шаге: середина отсортированного списка замеров (при чётном числе — среднее двух средних). Считается только время, пока вкладка видна. «Бросили здесь» — участники, которые не добавили проект в корзину, по последнему шагу редактора.</Formula>
            </div>
            <table className="stat-table">
              <thead>
                <tr>
                  <th scope="col">Шаг</th>
                  <th scope="col">Медиана</th>
                  <th scope="col">Бросили здесь</th>
                </tr>
              </thead>
              <tbody>
                {s.steps.rows.map((r) => (
                  <tr key={r.key} className={s.steps.worst?.key === r.key ? "worst" : undefined}>
                    <th scope="row">{r.label}</th>
                    <td>
                      {fmtDuration(r.medianSec)} <span className="muted small">({num(r.samples)})</span>
                    </td>
                    <td>
                      {num(r.dropped)} <span className="muted small">{p(r.dropShare)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {s.steps.worst && (
              <p className="small">
                Чаще всего бросают на шаге <b>«{s.steps.worst.label}»</b>: {p(s.steps.worst.dropShare)} всех, кто ушёл из редактора без корзины.
              </p>
            )}
          </section>

          <section className="card">
            <div className="row between">
              <h2 style={{ margin: 0 }}>ИИ-редактор</h2>
              <Formula>Доля проектов с правками = участники с событием «ИИ-правка» и «создан проект» ÷ участники с «создан проект» × 100%. Автоулучшенные фото — сумма фото, к которым применилось автоулучшение. Правок командой — число команд в редакторе фото.</Formula>
            </div>
            <div className="stat-tiles">
              <Tile label="Проекты с ИИ-правками" value={p(s.ai.projectsWithAiPct)} formula={`${num(s.ai.projectsWithAi)} из ${num(s.ai.projects)} участников, создавших проект.`} />
              <Tile label="Автоулучшенных фото" value={num(s.ai.autoEnhanced)} formula="Сумма фото с автоулучшением (событие «ИИ-правка», вид auto)." />
              <Tile label="ИИ-правок всего" value={num(s.ai.aiEdits)} formula="Все события «ИИ-правка» за период: автоулучшение и команды." />
            </div>
          </section>
          <p className="muted small">Событий за период: {num(s.events)}. События обезличены: без почты, имени и адреса.</p>
        </>
      )}
    </div>
  );
}
