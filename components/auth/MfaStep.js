"use client";
// Двухфакторный вход: подключение приложения-аутентификатора по QR-коду и ввод 6-значного кода.
import { useState } from "react";
import { callApi, goTo } from "../../lib/api";
import LogoutButton from "./LogoutButton";

export default function MfaStep({ mode, role, roleLabel, next, email }) {
  const [enroll, setEnroll] = useState(null); // { factorId, qr, secret } после «Показать QR-код»
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function continueWithoutCode() {
    setBusy(true);
    const res = await callApi("/api/v1/auth/role", { body: { role, next } });
    if (res.ok) return goTo(res.redirect);
    setBusy(false);
    setError(res.error?.message || "Не получилось выбрать роль.");
  }

  async function showQr() {
    setBusy(true);
    setError("");
    const res = await callApi("/api/v1/auth/mfa/enroll", { body: {} });
    setBusy(false);
    if (res.ok) return setEnroll(res);
    if (res.error?.code === "already_enrolled") return goTo(window.location.href);
    setError(res.error?.message || "Не получилось подготовить QR-код.");
  }

  async function verify(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await callApi("/api/v1/auth/mfa/verify", { body: { code, role, next, factorId: enroll?.factorId } });
    if (res.ok) return goTo(res.redirect);
    setBusy(false);
    setCode("");
    setError(res.error?.message || "Код не подошёл. Попробуйте ещё раз.");
  }

  if (mode === "skip")
    return (
      <div className="card stack">
        <h1>Код не нужен</h1>
        <p className="muted">Двухфакторный вход сейчас не требуется. Можно продолжить как {roleLabel.toLowerCase()}.</p>
        {error && <p className="err-text small" role="alert">{error}</p>}
        <button type="button" className="btn btn-primary btn-block" onClick={continueWithoutCode} disabled={busy}>
          {busy ? "Входим…" : "Продолжить"}
        </button>
      </div>
    );

  const codeForm = (
    <form onSubmit={verify} className="stack">
      <label className="field">
        <span>Код из приложения — 6 цифр</span>
        <input
          className="input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          autoFocus
          required
          style={{ fontSize: 24, letterSpacing: 6, textAlign: "center" }}
        />
      </label>
      {error && <p className="err-text small" role="alert">{error}</p>}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy || code.length !== 6}>
        {busy ? "Проверяем…" : "Подтвердить"}
      </button>
    </form>
  );

  return (
    <div className="card stack">
      <div>
        <h1>Подтвердите вход</h1>
        <p className="muted">
          Роль «{roleLabel}» защищена вторым шагом: кодом из приложения-аутентификатора на телефоне{email ? ` (${email})` : ""}.
        </p>
      </div>

      {mode === "code" && codeForm}

      {mode === "enroll" && !enroll && (
        <>
          <p>Приложение-аутентификатор ещё не подключено. Установите на телефон Google Authenticator, Яндекс Ключ или другое такое приложение и нажмите кнопку.</p>
          {error && <p className="err-text small" role="alert">{error}</p>}
          <button type="button" className="btn btn-primary btn-block" onClick={showQr} disabled={busy}>
            {busy ? "Готовим QR-код…" : "Показать QR-код"}
          </button>
        </>
      )}

      {mode === "enroll" && enroll && (
        <>
          <p>1. Отсканируйте QR-код в приложении-аутентификаторе.</p>
          <div style={{ background: "#fff", borderRadius: 12, padding: 12, width: 220, margin: "0 auto" }}>
            <img src={enroll.qr} alt="QR-код для приложения-аутентификатора" width="196" height="196" style={{ display: "block", width: "100%", height: "auto" }} />
          </div>
          <p className="muted small">
            Не получается отсканировать? Введите ключ вручную: <code style={{ wordBreak: "break-all" }}>{enroll.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          </p>
          <p>2. Введите 6 цифр, которые покажет приложение.</p>
          {codeForm}
        </>
      )}

      <LogoutButton className="btn btn-block" />
    </div>
  );
}
