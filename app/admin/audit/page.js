// Журнал действий (ОТ-04): последние 100 записей, только для роли admin. Время — по Минску.
import { ACTION_LABELS, OBJECT_LABELS, REASON_LABELS, RESULT_LABELS } from "@/lib/auditLabels";
import { ROLE_LABELS } from "@/lib/roles";
import { loadAudit } from "@/lib/server/auditRead";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Журнал действий — PicPac" };

const minsk = new Intl.DateTimeFormat("ru-RU", {
  timeZone: "Europe/Minsk",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export default async function AuditPage() {
  const auth = await requirePageRole(["admin"], "/admin/audit");
  let items = [];
  let failed = false;
  try {
    items = await loadAudit(auth.supabase, 100);
  } catch (e) {
    console.error(e?.message);
    failed = true;
  }

  return (
    <div>
      <div className="row between">
        <h1>Журнал действий</h1>
        <a href="/admin/audit" className="btn btn-small">
          Обновить
        </a>
      </div>
      <p className="muted">
        Последние {items.length || 100} записей. Время — по Минску (UTC+3). Изменить или удалить запись нельзя — так устроена база.
      </p>
      {failed && (
        <div className="card" role="alert">
          <b className="err-text">Не получилось загрузить журнал.</b>
          <p className="muted">Обновите страницу через минуту.</p>
        </div>
      )}
      {!failed && !items.length && <p className="muted">Записей пока нет.</p>}
      {items.map((item) => (
        <AuditRow key={item.id} item={item} />
      ))}
    </div>
  );
}

function AuditRow({ item }) {
  const d = item.details || {};
  const who = item.user_name || d.email || (item.user_id ? `аккаунт ${item.user_id.slice(0, 8)}…` : "гость");
  const object = item.object_type ? `${OBJECT_LABELS[item.object_type] || item.object_type}: ${item.object_type === "user" || item.object_type === "profile" ? item.object_id?.slice(0, 8) + "…" : item.object_id}` : "";
  const reason = d.reason ? REASON_LABELS[d.reason] || d.reason : "";
  const claimed = d.claimed_role && d.claimed_role !== item.role ? `роль в cookie: ${d.claimed_role}` : "";
  return (
    <div className={"card issue " + (item.result === "success" ? "ok" : item.result === "error" ? "err" : "")} style={{ opacity: 1 }}>
      <div className="row between">
        <b style={{ color: "var(--ds-color-text-strong)" }}>{ACTION_LABELS[item.action] || item.action}</b>
        <span className={"small " + (item.result === "success" ? "ok-text" : item.result === "error" ? "err-text" : "warn-text")}>{RESULT_LABELS[item.result] || item.result}</span>
      </div>
      <div className="small">
        <time dateTime={item.at}>{minsk.format(new Date(item.at))}</time> · {who}
        {item.role ? ` · ${ROLE_LABELS[item.role] || item.role}` : ""}
      </div>
      <div className="muted small">{[object, reason, claimed, item.ip ? `IP ${item.ip}` : ""].filter(Boolean).join(" · ")}</div>
    </div>
  );
}
