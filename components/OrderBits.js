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

const CHIP = {
  accepted: "#CFDDE7",
  moderation: "#E0DCE8",
  production: "#EDE1D5",
  shipped: "#C4DAD6",
  done: "#DEDFDC",
};

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

// Плашка статуса — пастельные заливки из брендбука
export function StatusChip({ status }) {
  return (
    <span className="chip" style={{ background: CHIP[status], color: "#364C49" }} data-status={status}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

// Лента статусов: время каждого шага по Минску и пояснение (причина смены)
export function Timeline({ order }) {
  const idx = STATUSES.indexOf(order.status);
  const history = order.history || [];
  return (
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
                {h?.reason ? ` · ${h.reason}` : ""}
              </div>
            ) : (
              i === idx + 1 && <div className="muted small">Следующий шаг</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
