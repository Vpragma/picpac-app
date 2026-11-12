"use client";
// Статусы заказа — ровно 5 из ТЗ (подписи из docs/night/plan.md, раздел 10). Данные ленты приходят с сервера.
import { IconCheck } from "./icons";

export const STATUS_LABELS = {
  accepted: "Принят",
  moderation: "Модерация",
  production: "Производство",
  shipped: "Готов / передан в доставку",
  done: "Завершён",
};
export const STATUSES = Object.keys(STATUS_LABELS);

// Суммы заказа — как в корзине: «96,35 BYN»
export const byn = (kop) => ((kop || 0) / 100).toFixed(2).replace(".", ",") + " BYN";

export function minskTime(iso, withYear = false) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", {
    timeZone: "Europe/Minsk",
    day: "numeric",
    month: "long",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function minskDay(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "long" });
}

// «17–18 ноября»; разные месяцы — «30 ноября – 1 декабря»; один день — «17 ноября»
export function minskDayRange(fromIso, toIso) {
  if (!fromIso) return "";
  const from = minskDay(fromIso);
  if (!toIso) return from;
  const to = minskDay(toIso);
  if (from === to) return from;
  const [d1, m1] = from.split(" ");
  const [d2, m2] = to.split(" ");
  return m1 === m2 ? `${d1}–${d2} ${m2}` : `${from} – ${to}`;
}

// Плашка статуса — пастельные заливки брендбука (токены --ds-color-status-*, класс .status-chip в app/brand.css)
export function StatusChip({ status }) {
  return (
    <span className="chip status-chip" data-status={status}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// Лента статусов: время каждого шага по Минску и пояснение (причина смены)
export function Timeline({ order }) {
  const idx = STATUSES.indexOf(order.status);
  const history = order.history || [];
  return (
    <>
    {typeof order.progress === "number" && (
      <div style={{ marginBottom: 12 }} data-testid="progress">
        <div role="progressbar" aria-label="Готовность заказа" aria-valuemin={0} aria-valuemax={100} aria-valuenow={order.progress} style={{ height: 8, borderRadius: 4, background: "var(--ds-color-bg-muted)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${order.progress}%`, background: "var(--ds-color-step-done)", transition: "width .4s" }} />
        </div>
        <div className="small" style={{ marginTop: 4 }}>
          <b>Готовность {order.progress} %</b>
          {order.substatus ? ` · ${order.substatus}` : ""}
        </div>
      </div>
    )}
    <ol className="timeline" aria-label="Статус заказа">
      {STATUSES.map((s, i) => {
        const step = (order.timeline || []).find((t) => t.status === s);
        const h = history.filter((x) => x.status === s).pop();
        const cls = i < idx || (i === idx && s === "done") ? "done" : i === idx ? "current" : "";
        return (
          <li key={s} className={cls} aria-current={i === idx ? "step" : undefined}>
            <span className="dot">{i <= idx && <IconCheck size={14} />}</span>
            <b>{STATUS_LABELS[s]}</b>
            {step?.at ? (
              <div className="muted small">
                {minskTime(step.at)}
                {h?.reason && s !== "production" ? ` · ${h.reason}` : ""}
              </div>
            ) : (
              i === idx + 1 && <div className="muted small">Следующий шаг</div>
            )}
            {s === "production" && i <= idx && !!order.substeps?.length && (
              <div role="list" aria-label="Этапы производства" data-testid="substeps" style={{ marginTop: 4, display: "grid", gap: 2 }}>
                {order.substeps.map((st) => (
                  <div role="listitem" key={st.stage} className="small" data-done={st.done ? "1" : "0"} style={{ color: st.done ? "inherit" : "var(--ds-color-text-muted)" }}>
                    <span aria-hidden="true">{st.done ? "✓ " : "○ "}</span>
                    {st.label}
                    <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{st.done ? " — готово" : " — впереди"}</span>
                    {st.at ? <span className="muted"> · {minskTime(st.at)}</span> : null}
                  </div>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
    </>
  );
}
