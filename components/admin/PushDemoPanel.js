"use client";
// Админка → «Демо пушей» (D9). Три кнопки по шаблонам, результат — простыми словами под кнопкой.
// Права проверяет сервер (только admin), частоту — тоже (раз в 10 секунд).
import { useEffect, useState } from "react";
import { callApi } from "@/lib/api";

const CLIENTS = ["client@example.com", "admin@example.com"];
const ACTIONS = [
  { id: "test", label: "Тестовый пуш", hint: "«PicPac: уведомления работают» — открывает профиль." },
  { id: "cart", label: "Напомнить о корзине сейчас", hint: "Текст из настоящей корзины клиента — открывает корзину." },
  { id: "advance", label: "Продвинуть последний заказ на шаг", hint: "Следующий статус с причиной «Демонстрация» — открывает заказ." },
];
const when = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

export default function PushDemoPanel() {
  const [email, setEmail] = useState(CLIENTS[0]);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState("");
  const [out, setOut] = useState({});

  const fetchInfo = (e) =>
    callApi(`/api/v1/admin/push-demo?email=${encodeURIComponent(e)}`, { method: "GET" }).then((r) => (r.ok ? r : { error: r.error?.message || "Не удалось загрузить устройства." }));

  useEffect(() => {
    let alive = true;
    fetchInfo(email).then((x) => alive && setInfo(x));
    return () => {
      alive = false;
    };
  }, [email]);

  const load = (e) => fetchInfo(e).then(setInfo);

  async function run(action) {
    if (busy) return;
    setBusy(action);
    setOut((o) => ({ ...o, [action]: { text: "Отправляем…", err: false } }));
    const r = await callApi("/api/v1/admin/push-demo", { body: { action, email } });
    setBusy("");
    setOut((o) => ({ ...o, [action]: { text: r.text || r.error?.message || "Не получилось. Попробуйте ещё раз.", err: !r.ok } }));
    load(email);
  }

  return (
    <>
      <section className="card">
        <label htmlFor="pd-client" className="small">
          Клиент (тестовый аккаунт)
        </label>
        <select id="pd-client" className="input" value={email} onChange={(e) => setEmail(e.target.value)}>
          {CLIENTS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <h2 style={{ fontSize: 16, marginTop: 12 }}>Устройства клиента</h2>
        {!info && <p className="muted small">Загружаем…</p>}
        {info?.error && <p className="small" role="alert">{info.error}</p>}
        {info?.devices && !info.devices.length && <p className="muted small">Нет подписанных устройств — включите уведомления в профиле на телефоне.</p>}
        {!!info?.devices?.length && (
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {info.devices.map((d) => (
              <li key={d.id}>
                {d.device} · подписка {when(d.createdAt)} · последняя доставка {when(d.lastOkAt)}
              </li>
            ))}
          </ul>
        )}
      </section>
      {ACTIONS.map((a) => (
        <section className="card" key={a.id}>
          <button type="button" className={"btn btn-block" + (a.id === "cart" ? " btn-primary" : "")} onClick={() => run(a.id)} disabled={!!busy}>
            {busy === a.id ? "Отправляем…" : a.label}
          </button>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {a.hint}
          </p>
          {out[a.id] && (
            <p className="small" role="status" data-testid={`pd-${a.id}`} style={{ marginBottom: 0, fontWeight: 600, color: out[a.id].err ? "var(--danger, #b42318)" : undefined }}>
              {out[a.id].text}
            </p>
          )}
        </section>
      ))}
      {!!info?.log?.length && (
        <section className="card">
          <h2 style={{ fontSize: 16 }}>Последние демо-пуши</h2>
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            {info.log.map((l, i) => (
              <li key={i}>
                {when(l.at)} · {l.email} · {l.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
