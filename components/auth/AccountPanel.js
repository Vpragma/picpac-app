"use client";
// Карточка аккаунта в профиле: имя (можно изменить), почта, роли, выход, удаление аккаунта.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi, goTo } from "../../lib/api";
import { ROLE_LABELS, isStaffRole } from "../../lib/roles";
import { wipeDevice } from "../../lib/device";
import { notify } from "../../lib/store";
import LogoutButton from "./LogoutButton";

export default function AccountPanel({ name, email, roles, activeRole, isDemo, mfa }) {
  return (
    <>
      <div className="card stack">
        <NameEditor initial={name} />
        <div>
          <div className="muted small">Почта</div>
          <div>{email}</div>
        </div>
        <div>
          <div className="muted small">Роли</div>
          <div className="row wrap" style={{ marginTop: 4 }}>
            {roles.map((r) => (
              <span key={r} className={"chip" + (r === activeRole ? " chip-hl" : "")}>
                {ROLE_LABELS[r]}
                {r === activeRole ? " · сейчас" : ""}
              </span>
            ))}
          </div>
        </div>
        {mfa && (
          <div>
            <div className="muted small">Двухфакторный вход для сотрудников</div>
            {!mfa.required ? (
              <div className="small">Сейчас не обязателен: для входа хватает пароля. Обязательный код для сотрудников включает администратор стенда.</div>
            ) : mfa.enrolled ? (
              <div className="small ok-text">Подключён: при входе с ролью сотрудника нужен код из приложения-аутентификатора.</div>
            ) : (
              <div className="small">
                Не подключён.{" "}
                <Link href={`/login/mfa?role=${mfa.role}&next=/profile`}>Подключить по QR-коду</Link>
              </div>
            )}
          </div>
        )}
        <div className="row wrap">
          {isStaffRole(activeRole) && (
            <Link href="/admin" className="btn btn-small btn-primary">
              Админка
            </Link>
          )}
          {roles.length > 1 && (
            <Link href="/login/role?next=/profile" className="btn btn-small">
              Сменить роль
            </Link>
          )}
          <LogoutButton className="btn btn-small" />
        </div>
      </div>
      <DeleteAccount email={email} isDemo={isDemo} />
    </>
  );
}

function NameEditor({ initial }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [draft, setDraft] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await callApi("/api/v1/me", { method: "PATCH", body: { name: draft } });
    setBusy(false);
    if (!res.ok) return setError(res.error?.message || "Не получилось сохранить имя.");
    setName(res.name);
    setEditing(false);
    notify("Имя сохранено", "success");
    router.refresh();
  }

  if (!editing)
    return (
      <div className="row between">
        <div>
          <div className="muted small">Имя</div>
          <b className="sum-strong">{name || "Без имени"}</b>
        </div>
        <button
          type="button"
          className="btn btn-small"
          onClick={() => {
            setDraft(name);
            setEditing(true);
          }}
        >
          Изменить
        </button>
      </div>
    );

  return (
    <form onSubmit={save}>
      <label className="field">
        <span>Имя</span>
        <input className="input" autoComplete="name" maxLength={100} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus required />
      </label>
      {error && (
        <p className="err-text small" role="alert">
          {error}
        </p>
      )}
      <div className="row">
        <button className="btn btn-small btn-primary" type="submit" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить"}
        </button>
        <button className="btn btn-small" type="button" onClick={() => setEditing(false)} disabled={busy}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function DeleteAccount({ email, isDemo }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function remove(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await callApi("/api/v1/me", { method: "DELETE", body: { password } });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error?.message || "Не получилось удалить аккаунт.");
    }
    // Данные аккаунта на устройстве тоже стираем (черновики, фото, корзина, кэш)
    await wipeDevice();
    notify(`Аккаунт ${email} удалён`, "success");
    goTo(res.redirect || "/");
  }

  return (
    <section className="card">
      {!open ? (
        <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
          Удалить аккаунт
        </button>
      ) : isDemo ? (
        <div className="stack">
          <h3>Удаление аккаунта</h3>
          <p className="muted">Это общий тестовый аккаунт — его удалить нельзя, им пользуются другие проверяющие. Зарегистрируйте свой аккаунт, чтобы проверить удаление.</p>
          <button type="button" className="btn btn-small" onClick={() => setOpen(false)}>
            Понятно
          </button>
        </div>
      ) : (
        <form onSubmit={remove} className="stack">
          <h3>Удалить аккаунт навсегда?</h3>
          <p className="muted small">
            Удалятся вход, профиль и роли. Отменить это нельзя. Записи журнала действий останутся — так требует безопасность.
          </p>
          <label className="field">
            <span>Для подтверждения введите пароль</span>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          {error && (
            <p className="err-text small" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button className="btn btn-small" type="submit" disabled={busy || !password} style={{ borderColor: "var(--ds-color-error)", color: "var(--ds-color-error)" }}>
              {busy ? "Удаляем…" : "Удалить навсегда"}
            </button>
            <button className="btn btn-small" type="button" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
