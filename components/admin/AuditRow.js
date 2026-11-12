// Строка журнала действий. Без "use client": рисуется и на сервере (экран журнала), и в браузере (поиск по почте).
// N9: группа одинаковых событий подряд — та же строка с плашкой «×N», периодом и раскрывающимся списком.
import { ACTION_LABELS, OBJECT_LABELS, ORDER_STATUS_LABELS, REASON_LABELS, RESULT_LABELS } from "@/lib/auditLabels";
import { auditActor } from "@/lib/auditView";
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
const minskTime = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Minsk", hour: "2-digit", minute: "2-digit", second: "2-digit" });

const ACTOR_LABELS = { test: "автотест", erp: "ERP", system: "система" };

function objectText(item) {
  if (!item.object_type) return "";
  const id = item.object_type === "user" || item.object_type === "profile" ? item.object_id?.slice(0, 8) + "…" : item.object_id;
  return `${OBJECT_LABELS[item.object_type] || item.object_type}: ${id}`;
}

function reasonText(d) {
  // Неизвестный служебный код не показываем как есть — понятная подпись и код в скобках для разработчика
  return d.reason ? REASON_LABELS[d.reason] || `другая причина (${String(d.reason).slice(0, 40)})` : "";
}

// Что изменилось (админские действия N9): роль, поля каталога
function changeText(item) {
  const d = item.details || {};
  if (d.role && (item.action === "admin.role_grant" || item.action === "admin.role_revoke")) return `роль: ${ROLE_LABELS[d.role] || d.role}`;
  if (d.changes && typeof d.changes === "object") return `изменено полей: ${Object.keys(d.changes).length}`;
  if (d.count != null && item.action === "admin.orders_export") return `строк: ${d.count}`;
  if (d.from && d.to && item.action === "order.status_change") return `${ORDER_STATUS_LABELS[d.from] || d.from} → ${ORDER_STATUS_LABELS[d.to] || d.to}`;
  return "";
}

// Одна запись внутри раскрытой группы: время, объект, причина, IP
function AuditMini({ item }) {
  const d = item.details || {};
  return (
    <li>
      <time dateTime={item.at}>{minskTime.format(new Date(item.at))}</time>
      {" · "}
      {[objectText(item), reasonText(d), changeText(item), item.ip ? `IP ${item.ip}` : ""].filter(Boolean).join(" · ") || "без подробностей"}
    </li>
  );
}

export default function AuditRow({ item, group = null }) {
  const d = item.details || {};
  const who = item.user_name || d.email || (item.user_id ? `аккаунт ${item.user_id.slice(0, 8)}…` : "гость");
  const claimed = d.claimed_role && d.claimed_role !== item.role ? `заявленная роль: ${ROLE_LABELS[d.claimed_role] || d.claimed_role}` : "";
  const count = group?.length || 1;
  const oldest = count > 1 ? group[group.length - 1] : null;
  const actor = auditActor(item);
  const SHOWN = 30;
  return (
    <div className={"card issue audit-row " + (item.result === "success" ? "ok" : item.result === "error" ? "err" : "")} style={{ opacity: 1 }} data-testid={count > 1 ? "audit-group" : "audit-row"}>
      <div className="row between">
        <b style={{ color: "var(--ds-color-text-strong)" }}>
          {ACTION_LABELS[item.action] || item.action}
          {count > 1 && (
            <span className="chip audit-count" data-testid="audit-count" title={`${count} одинаковых событий подряд`}>
              ×{count}
            </span>
          )}
        </b>
        <span className={"small " + (item.result === "success" ? "ok-text" : item.result === "error" ? "err-text" : "warn-text")}>{RESULT_LABELS[item.result] || item.result}</span>
      </div>
      <div className="small">
        {oldest ? (
          <>
            <time dateTime={oldest.at}>{minsk.format(new Date(oldest.at))}</time> — <time dateTime={item.at}>{minskTime.format(new Date(item.at))}</time>
          </>
        ) : (
          <time dateTime={item.at}>{minsk.format(new Date(item.at))}</time>
        )}{" "}
        · {who}
        {item.role ? ` · ${ROLE_LABELS[item.role] || item.role}` : ""}
        {actor !== "human" ? ` · ${ACTOR_LABELS[actor]}` : ""}
        {item.user_id && (
          <>
            {" · "}
            <a href={`/admin/audit?user=${item.user_id}`} className="audit-link">
              только этот пользователь
            </a>
          </>
        )}
      </div>
      {count === 1 ? (
        <div className="muted small">{[objectText(item), reasonText(d), changeText(item), claimed, item.ip ? `IP ${item.ip}` : ""].filter(Boolean).join(" · ")}</div>
      ) : (
        <details className="audit-more">
          <summary>Показать все {count}</summary>
          <ol className="audit-mini small">
            {group.slice(0, SHOWN).map((g) => (
              <AuditMini key={g.id} item={g} />
            ))}
          </ol>
          {count > SHOWN && <p className="muted small">и ещё {count - SHOWN} — откройте «только этот пользователь» или сузьте период.</p>}
        </details>
      )}
    </div>
  );
}
