"use client";
import { STATUSES, statusLabel } from "../lib/orders";
import { IconCheck } from "./icons";

const CHIP = {
  accepted: "#CFDDE7",
  moderation: "#E0DCE8",
  production: "#EDE1D5",
  shipped: "#C4DAD6",
  done: "#DEDFDC",
};

// Плашка статуса — пастельные заливки из брендбука
export function StatusChip({ status }) {
  return (
    <span className="chip" style={{ background: CHIP[status], color: "#364C49" }}>
      {statusLabel(status)}
    </span>
  );
}

export function Timeline({ order }) {
  const idx = STATUSES.findIndex((s) => s.id === order.status);
  return (
    <ol className="timeline">
      {STATUSES.map((s, i) => {
        const h = (order.history || []).filter((x) => x.status === s.id).pop();
        const cls = i < idx || (i === idx && s.id === "done") ? "done" : i === idx ? "current" : "";
        return (
          <li key={s.id} className={cls}>
            <span className="dot">{i <= idx && <IconCheck size={14} />}</span>
            <b>{s.label}</b>
            {h && (
              <div className="muted small">
                {new Date(h.at).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
