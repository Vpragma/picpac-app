"use client";
// ЧЕРНОВИК: экран входа без настоящей защиты (см. lib/auth.js).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { checkLogin } from "../../lib/auth";
import { writeKey, notify } from "../../lib/store";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [choose, setChoose] = useState(null);

  function enter(account, role) {
    writeKey("session", { email: account.email, name: account.name, role });
    notify(role === "admin" ? "Вы вошли как администратор" : "Вы вошли", "success");
    router.push(role === "admin" ? "/admin" : "/profile");
  }

  function submit(e) {
    e.preventDefault();
    const acc = checkLogin(email, password);
    if (!acc) return setError("Неверная почта или пароль. Для демо: client@test или admin@test, пароль demo.");
    setError("");
    if (acc.roles.includes("admin")) setChoose(acc);
    else enter(acc, "client");
  }

  if (choose)
    return (
      <div className="card stack">
        <h2>Как войти?</h2>
        <p className="muted">У аккаунта {choose.email} есть права администратора.</p>
        <button className="btn btn-primary btn-block" onClick={() => enter(choose, "client")}>Войти как клиент</button>
        <button className="btn btn-block" onClick={() => enter(choose, "admin")}>Войти как администратор</button>
      </div>
    );

  return (
    <form className="card" onSubmit={submit}>
      <h1>Вход PicPac</h1>
      <label className="field">
        <span>Почта</span>
        <input className="input" type="text" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Пароль</span>
        <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="err-text small">{error}</p>}
      <button className="btn btn-primary btn-block" type="submit">Войти</button>
      <p className="muted small" style={{ marginTop: 12 }}>
        Демо-аккаунты: client@test и admin@test, пароль demo. Это черновик — настоящая защита будет в следующей версии.
      </p>
    </form>
  );
}
