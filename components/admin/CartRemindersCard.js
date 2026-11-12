"use client";
// Админка → «Напоминания»: задержка напоминания о забытой корзине и кнопка «Отправить напоминания сейчас» (D5).
// Права проверяет сервер (только admin). Правила те же, что у расписания: тихие часы, одно напоминание на корзину.
import { useState } from "react";
import { callApi } from "@/lib/api";

const LABELS = { 5: "5 минут (демо)", 60: "1 час", 1440: "24 часа" };

export default function CartRemindersCard({ initialAfter }) {
  const [after, setAfter] = useState(initialAfter);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: "", err: false });

  async function save(value) {
    if (busy) return;
    setBusy(true);
    const r = await callApi("/api/v1/admin/cart-reminders", { method: "PUT", body: { afterMinutes: value } });
    setBusy(false);
    if (r.ok) {
      setAfter(r.afterMinutes);
      setMsg({ text: `Задержка: ${LABELS[r.afterMinutes]}.`, err: false });
    } else setMsg({ text: r.error?.message || "Не сохранилось.", err: true });
  }

  async function runNow() {
    if (busy) return;
    setBusy(true);
    setMsg({ text: "", err: false });
    const r = await callApi("/api/v1/admin/cart-reminders", { body: {} });
    setBusy(false);
    if (!r.ok) return setMsg({ text: r.error?.message || "Не получилось отправить.", err: true });
    const parts = [`Новых напоминаний: ${r.created}`, `пушей отправлено: ${r.pushed}`];
    if (r.quiet) parts.push(`ждут утра (тихие часы): ${r.quiet}`);
    if (r.due && !r.created) parts.push("остальным корзинам уже напоминали");
    setMsg({ text: parts.join(" · ") + ".", err: false });
  }

  return (
    <section className="card stack" aria-labelledby="rem-h">
      <h2 id="rem-h" style={{ fontSize: 18 }}>
        Напоминания о забытой корзине
      </h2>
      <p className="muted small" style={{ margin: 0 }}>
        Одно напоминание на корзину: в центре уведомлений и пушем (если клиент включил). Не ночью: 22:00–09:00 по Минску. Расписание проверяет корзины раз в 15 минут.
      </p>
      <label className="field" style={{ margin: 0 }}>
        <span>Напоминать, если корзину не трогали</span>
        <select className="input" value={after} disabled={busy} onChange={(e) => save(Number(e.target.value))}>
          {Object.entries(LABELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn-primary btn-block" onClick={runNow} disabled={busy}>
        {busy ? "Отправляем…" : "Отправить напоминания сейчас"}
      </button>
      {msg.text && (
        <p className={"small " + (msg.err ? "err-text" : "")} role={msg.err ? "alert" : "status"} style={{ margin: 0 }}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
