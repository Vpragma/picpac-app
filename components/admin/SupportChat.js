"use client";
// Чат оператора: переписка с клиентом по обращению, ответ и «Ответить и закрыть».
// Клиент видит ответ в заказе и получает уведомление «Ответ поддержки».
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../../lib/api";
import { minskTime } from "../OrderBits";

const AUTHOR = { client: "Клиент", bot: "Бот", operator: "Оператор" };
const STATUS = { open: "Ждёт ответа", answered: "Есть ответ", closed: "Закрыто" };

export default function SupportChat({ id }) {
  const [res, setRes] = useState(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const r = await callApi(`/api/v1/admin/interactions/${encodeURIComponent(id)}`, { method: "GET" });
    setRes((prev) => (r.status === 0 && prev?.ok ? prev : r));
  }, [id]);

  useEffect(() => {
    let alive = true;
    const tick = () => alive && load();
    tick();
    const t = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load]);

  async function send(close) {
    if (busy) return;
    setError("");
    if (text.trim().length < 2) return setError("Напишите ответ — от 2 символов.");
    setBusy(true);
    const r = await callApi(`/api/v1/admin/interactions/${encodeURIComponent(id)}`, { body: { body: text.trim(), close } });
    setBusy(false);
    if (!r.ok) return setError(r.error?.message || "Не получилось отправить ответ.");
    setText("");
    load();
  }

  if (!res) return <p className="muted">Загружаем обращение…</p>;
  if (!res.ok) return <p className="error-text">{res.status === 404 ? "Обращение не найдено." : res.error?.message}</p>;
  const { interaction: it, order: o, messages } = res;
  return (
    <div>
      <div className="row between wrap" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: "1.4rem" }}>{it.topic}</h1>
        <span className="chip" data-testid="interaction-status">
          {STATUS[it.status] || it.status}
        </span>
      </div>
      <p className="muted small">
        Заказ <Link href={`/admin/orders/${o.id}`}>{o.number}</Link> · {o.statusLabel} · клиент {o.client.name || "—"}, {o.client.phone || "—"} · ответить до {minskTime(it.slaDue)}
      </p>
      <section className="card">
        <div className="chat" data-testid="operator-chat">
          {messages.map((m) => (
            <div key={m.id} className={"bubble " + (m.author === "operator" ? "me" : "bot")} data-author={m.author}>
              <b className="small" style={{ display: "block" }}>
                {AUTHOR[m.author] || m.author} · {minskTime(m.createdAt)}
              </b>
              <span style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{m.body}</span>
            </div>
          ))}
        </div>
      </section>
      {it.status === "closed" ? (
        <p className="muted">Обращение закрыто.</p>
      ) : (
        <section className="card stack">
          <label className="field">
            <span>Ответ клиенту</span>
            <textarea className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Здравствуйте! …" />
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={() => send(false)} disabled={busy}>
              {busy ? "Отправляем…" : "Ответить"}
            </button>
            <button type="button" className="btn" onClick={() => send(true)} disabled={busy}>
              Ответить и закрыть
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
