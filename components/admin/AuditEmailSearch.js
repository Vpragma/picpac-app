"use client";
// Поиск записей журнала по почте. Почта уходит только телом POST-запроса — в адрес страницы она не попадает.
import { useState } from "react";
import { callApi } from "@/lib/api";
import AuditRow from "./AuditRow";

export default function AuditEmailSearch() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState({ busy: false, error: "", items: null, next: null });

  async function search(e, before) {
    e?.preventDefault();
    if (state.busy) return;
    setState((s) => ({ ...s, busy: true, error: "" }));
    const r = await callApi("/api/v1/admin/audit", { body: { email, ...(before ? { before } : {}) } });
    if (!r.ok) return setState((s) => ({ ...s, busy: false, error: r.error?.message || "Не получилось найти." }));
    setState((s) => ({ busy: false, error: "", items: before ? [...(s.items || []), ...r.items] : r.items, next: r.next }));
  }

  return (
    <section className="card" aria-labelledby="audit-email-h">
      <h2 id="audit-email-h" style={{ fontSize: 18 }}>
        Поиск по почте
      </h2>
      <form onSubmit={search} noValidate style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0 12px", alignItems: "end" }}>
        <label className="field">
          <span>Почта</span>
          <input className="input" type="email" name="email" autoComplete="off" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <button className="btn" type="submit" disabled={state.busy || !email.trim()}>
            {state.busy ? "Ищем…" : "Найти по почте"}
          </button>
          {state.items && (
            <button className="btn" type="button" onClick={() => setState({ busy: false, error: "", items: null, next: null })}>
              Скрыть
            </button>
          )}
        </div>
      </form>
      <p className="muted small">Почта не попадает в адрес страницы и историю браузера.</p>
      {state.error && (
        <p className="err-text small" role="alert">
          {state.error}
        </p>
      )}
      {state.items && (
        <div aria-live="polite">
          <p className="small">Найдено записей: {state.items.length}{state.next ? "+" : ""}</p>
          {state.items.map((item) => (
            <AuditRow key={item.id} item={item} />
          ))}
          {state.next && (
            <button className="btn" type="button" disabled={state.busy} onClick={() => search(null, state.next)}>
              Показать ещё
            </button>
          )}
        </div>
      )}
    </section>
  );
}
