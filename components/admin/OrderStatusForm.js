"use client";
// Ручная смена статуса: один из 5 статусов + обязательная причина (от 5 символов). Причина остаётся в журнале,
// клиент видит новый статус и нейтральный текст.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "../../lib/api";
import { STATUS_LABELS, STATUSES } from "../OrderBits";

export default function OrderStatusForm({ orderId, current }) {
  const router = useRouter();
  const [status, setStatus] = useState(STATUSES[Math.min(STATUSES.indexOf(current) + 1, STATUSES.length - 1)]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  const short = reason.trim().length < 5;

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setDone("");
    if (short) return setError("Укажите причину — от 5 символов.");
    setBusy(true);
    const r = await callApi(`/api/v1/admin/orders/${orderId}/status`, { body: { status, reason: reason.trim() } });
    setBusy(false);
    if (!r.ok) return setError(r.error?.fields?.reason || r.error?.message || "Не получилось сменить статус.");
    setReason("");
    setStatus(STATUSES.find((x) => x !== r.order.status && STATUSES.indexOf(x) > STATUSES.indexOf(r.order.status)) || STATUSES.find((x) => x !== r.order.status));
    setDone(`Статус изменён: «${STATUS_LABELS[r.order.status]}».`);
    router.refresh();
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <label className="field">
        <span>Новый статус</span>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s} disabled={s === current}>
              {STATUS_LABELS[s]}
              {s === current ? " (сейчас)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Причина (обязательно)</span>
        <textarea
          className="input"
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={!!error}
          aria-describedby="status-reason-help"
          placeholder="Например: ERP не прислал событие, проверили в цехе"
        />
      </label>
      <p id="status-reason-help" className="muted small" style={{ margin: 0 }}>
        Клиент увидит новый статус, причина останется в журнале действий.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p className="ok-text" role="status">
          {done}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        {busy ? "Меняем…" : "Сменить статус"}
      </button>
    </form>
  );
}
