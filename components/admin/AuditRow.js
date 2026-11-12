// Строка журнала действий. Без "use client": рисуется и на сервере (экран журнала), и в браузере (поиск по почте).
import { ACTION_LABELS, OBJECT_LABELS, REASON_LABELS, RESULT_LABELS } from "@/lib/auditLabels";
import { ROLE_LABELS } from "@/lib/roles";

const minsk = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Minsk",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export default function AuditRow({ item }) {
  const d = item.details || {};
  const who = item.user_name || d.email || (item.user_id ? `аккаунт ${item.user_id.slice(0, 8)}…` : "гость");
  const object = item.object_type ? `${OBJECT_LABELS[item.object_type] || item.object_type}: ${item.object_type === "user" || item.object_type === "profile" ? item.object_id?.slice(0, 8) + "…" : item.object_id}` : "";
  const reason = d.reason ? REASON_LABELS[d.reason] || d.reason : "";
  const claimed = d.claimed_role && d.claimed_role !== item.role ? `роль в cookie: ${d.claimed_role}` : "";
  return (
    <div className={"card issue audit-row " + (item.result === "success" ? "ok" : item.result === "error" ? "err" : "")} style={{ opacity: 1 }}>
      <div className="row between">
        <b style={{ color: "var(--ds-color-text-strong)" }}>{ACTION_LABELS[item.action] || item.action}</b>
        <span className={"small " + (item.result === "success" ? "ok-text" : item.result === "error" ? "err-text" : "warn-text")}>{RESULT_LABELS[item.result] || item.result}</span>
      </div>
      <div className="small">
        <time dateTime={item.at}>{minsk.format(new Date(item.at))}</time> · {who}
        {item.role ? ` · ${ROLE_LABELS[item.role] || item.role}` : ""}
        {item.user_id && (
          <>
            {" · "}
            <a href={`/admin/audit?user=${item.user_id}`} className="audit-link">
              только этот пользователь
            </a>
          </>
        )}
      </div>
      <div className="muted small">{[object, reason, claimed, item.ip ? `IP ${item.ip}` : ""].filter(Boolean).join(" · ")}</div>
    </div>
  );
}
