"use client";
// N9: выдать или снять роль модератора/администратора. Сервер ещё раз проверяет всё (свои роли, последний админ,
// демо и синтетика) и пишет журнал; здесь — только кнопки, подтверждение и понятная ошибка.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/api";
import { ROLE_LABELS } from "@/lib/roles";

const STAFF = ["moderator", "admin"];

export default function UserRoleButtons({ user }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState({ text: "", error: false });
  const locked = user.isSelf ? "Свои роли менять нельзя" : user.isDemo ? "Демо-аккаунт: роли фиксированы" : user.isSynthetic ? "Синтетика (набор жюри)" : "";
  if (locked) return <span className="muted small">{locked}</span>;

  async function toggle(role) {
    const grant = !user.roles.includes(role);
    const label = ROLE_LABELS[role].toLowerCase();
    if (!window.confirm(`${grant ? "Выдать" : "Снять"} роль «${label}» пользователю ${user.email}?`)) return;
    setBusy(role);
    setMsg({ text: "", error: false });
    const r = await callApi(`/api/v1/admin/users/${user.id}/roles`, { body: { role, grant } });
    setBusy("");
    if (!r.ok) return setMsg({ text: r.error?.message || "Не получилось изменить роль.", error: true });
    setMsg({ text: grant ? `Роль «${label}» выдана.` : `Роль «${label}» снята.`, error: false });
    router.refresh();
  }

  return (
    <div>
      <div className="admin-actions">
        {STAFF.map((role) => {
          const has = user.roles.includes(role);
          return (
            <button key={role} type="button" className={"btn btn-small" + (has ? "" : " btn-secondary")} disabled={!!busy} onClick={() => toggle(role)} data-testid={`role-${has ? "revoke" : "grant"}-${role}`}>
              {busy === role ? "…" : has ? `Снять: ${ROLE_LABELS[role].toLowerCase()}` : `Сделать: ${ROLE_LABELS[role].toLowerCase()}`}
            </button>
          );
        })}
      </div>
      <p className={"small " + (msg.error ? "err-text" : "ok-text")} role="status" aria-live="polite" style={{ margin: msg.text ? "4px 0 0" : 0 }}>
        {msg.text}
      </p>
    </div>
  );
}
