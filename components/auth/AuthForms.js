"use client";
// Формы входа и регистрации. Пароль проверяет только сервер; здесь — подсказки по заполнению.
import Link from "next/link";
import { useState } from "react";
import { callApi, goTo } from "../../lib/api";
import { PASSWORD_MIN } from "../../lib/validate";

export default function AuthForms({ next = "", reason = "", initialMode = "login" }) {
  const [mode, setMode] = useState(initialMode);
  return (
    <div className="narrow">
      {reason === "checkout" && (
        <div className="card" role="status">
          <b style={{ color: "var(--ds-color-text-strong)" }}>Осталось войти — и заказ готов</b>
          <p className="muted" style={{ margin: "4px 0 0" }}>
            Войдите или зарегистрируйтесь, и мы вернём вас в корзину. Корзина и черновик фотокниги сохранятся.
          </p>
        </div>
      )}
      <div className="card">
        <div className="options" role="tablist" aria-label="Вход или регистрация" style={{ marginBottom: 16 }}>
          <button type="button" role="tab" aria-selected={mode === "login"} className={"option" + (mode === "login" ? " selected" : "")} onClick={() => setMode("login")}>
            <b>Вход</b>
          </button>
          <button type="button" role="tab" aria-selected={mode === "register"} className={"option" + (mode === "register" ? " selected" : "")} onClick={() => setMode("register")}>
            <b>Регистрация</b>
          </button>
        </div>
        {mode === "login" ? <LoginForm next={next} /> : <RegisterForm next={next} />}
      </div>
      {reason === "checkout" ? (
        <>
          <Link href="/cart" className="btn btn-block">
            Вернуться в корзину
          </Link>
          <p className="muted small" style={{ textAlign: "center" }}>
            Без входа заказ не оформить, но корзина, форма и черновик сохранятся на этом устройстве.
          </p>
        </>
      ) : (
        <Link href="/" className="btn btn-block">
          Продолжить как гость
        </Link>
      )}
    </div>
  );
}

function PasswordField({ label, value, onChange, autoComplete, error, hint }) {
  const [shown, setShown] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="row">
        <input
          className="input"
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          aria-invalid={error ? "true" : undefined}
          required
        />
        <button type="button" className="btn btn-small" onClick={() => setShown(!shown)} aria-pressed={shown}>
          {shown ? "Скрыть" : "Показать"}
        </button>
      </div>
      {hint && !error && <small className="muted small">{hint}</small>}
      {error && <small className="err-text small">{error}</small>}
    </label>
  );
}

function LoginForm({ next }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await callApi("/api/v1/auth/login", { body: { email, password, next } });
    if (res.ok) return goTo(res.redirect);
    setBusy(false);
    setError(res.error?.message || "Не получилось войти. Попробуйте ещё раз.");
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>Вход в PicPac</h1>
      <label className="field">
        <span>Почта</span>
        <input className="input" type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="current-password" />
      {error && (
        <p className="err-text small" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? "Входим…" : "Войти"}
      </button>
    </form>
  );
}

function RegisterForm({ next }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fields, setFields] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    // Подсказка до отправки; окончательно проверяет сервер
    if (password.length < PASSWORD_MIN) {
      setFields({ password: `Пароль должен быть не короче ${PASSWORD_MIN} символов.` });
      return;
    }
    setBusy(true);
    setError("");
    setFields({});
    const res = await callApi("/api/v1/auth/register", { body: { name, email, password, next } });
    if (res.ok) return goTo(res.redirect);
    setBusy(false);
    setFields(res.fields || {});
    setError(res.error?.message || "Не получилось зарегистрироваться. Попробуйте ещё раз.");
  }

  return (
    <form onSubmit={submit} noValidate>
      <h1>Регистрация</h1>
      <label className="field">
        <span>Имя</span>
        <input className="input" autoComplete="name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={fields.name ? "true" : undefined} required />
        {fields.name && <small className="err-text small">{fields.name}</small>}
      </label>
      <label className="field">
        <span>Почта</span>
        <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={fields.email ? "true" : undefined} required />
        {fields.email && <small className="err-text small">{fields.email}</small>}
      </label>
      <PasswordField label="Пароль" value={password} onChange={setPassword} autoComplete="new-password" error={fields.password} hint={`От ${PASSWORD_MIN} символов`} />
      {error && (
        <p className="err-text small" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
        {busy ? "Создаём аккаунт…" : "Зарегистрироваться"}
      </button>
      <p className="muted small" style={{ marginTop: 12 }}>
        Это тестовый прототип: письмо с подтверждением не придёт, вход — сразу после регистрации.
      </p>
    </form>
  );
}
