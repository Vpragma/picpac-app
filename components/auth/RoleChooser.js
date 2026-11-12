"use client";
// Кнопки выбора роли. Сервер запишет роль, только если она действительно есть у аккаунта.
import { useState } from "react";
import { callApi, goTo } from "../../lib/api";
import { ROLE_LABELS, isStaffRole } from "../../lib/roles";
import LogoutButton from "./LogoutButton";

const ROLE_NOTES = {
  client: "Каталог, фотокниги, заказы",
  moderator: "Очередь заказов и статусы",
  admin: "Всё, что модератор, плюс заказы, пользователи, каталог, статистика, промокоды, сезон и журнал действий",
};

export default function RoleChooser({ roles, activeRole, next, name, email, mfaRequired }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function choose(role) {
    setBusy(role);
    setError("");
    const res = await callApi("/api/v1/auth/role", { body: { role, next } });
    if (res.ok) return goTo(res.redirect);
    setBusy("");
    setError(res.error?.message || "Не получилось выбрать роль. Попробуйте ещё раз.");
  }

  return (
    <div className="card stack">
      <div>
        <h1>Как войти?</h1>
        <p className="muted">
          {name ? `${name} · ` : ""}
          {email}. У аккаунта несколько ролей — выберите, с какой работать сейчас.
        </p>
      </div>
      {roles.map((role) => (
        <button key={role} type="button" className={"option" + (role === activeRole ? " selected" : "")} style={{ width: "100%" }} onClick={() => choose(role)} disabled={!!busy}>
          <b>
            {busy === role ? "Входим…" : `Войти как ${ROLE_LABELS[role].toLowerCase()}`}
            {role === activeRole ? " · сейчас" : ""}
          </b>
          <span>
            {ROLE_NOTES[role]}
            {isStaffRole(role) && mfaRequired ? " · нужен код из приложения-аутентификатора" : ""}
          </span>
        </button>
      ))}
      {error && (
        <p className="err-text small" role="alert">
          {error}
        </p>
      )}
      <LogoutButton className="btn btn-block" />
    </div>
  );
}
