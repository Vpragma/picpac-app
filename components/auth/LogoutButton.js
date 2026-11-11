"use client";
// Кнопка «Выйти»: сервер закрывает сессию и сбрасывает выбранную роль
import { useState } from "react";
import { callApi, goTo } from "../../lib/api";
import { notify } from "../../lib/store";

export default function LogoutButton({ className = "btn" }) {
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    const res = await callApi("/api/v1/auth/logout");
    if (res.ok) return goTo(res.redirect || "/");
    setBusy(false);
    notify(res.error?.message || "Не получилось выйти. Попробуйте ещё раз.", "error");
  }
  return (
    <button type="button" className={className} onClick={logout} disabled={busy}>
      {busy ? "Выходим…" : "Выйти"}
    </button>
  );
}
