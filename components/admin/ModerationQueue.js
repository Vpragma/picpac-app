"use client";
// Очередь модерации: фото по подписанной ссылке (10 минут), оценки классификатора, номер заказа, клиент — инициалы.
// «Одобрить» или «Вернуть на замену» с обязательной причиной из списка. Опрос раз в 30 с.
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../../lib/api";
import { RETURN_REASONS } from "../../lib/moderation";
import { minskTime } from "../OrderBits";

const pct = (v) => (typeof v === "number" ? Math.round(v * 100) + " %" : "—");

function Card({ item, onDone }) {
  const [mode, setMode] = useState(null); // null | "return"
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);

  async function decide(decision) {
    if (busy) return;
    setError("");
    if (decision === "return" && !reason) return setError("Выберите причину возврата.");
    setBusy(true);
    const r = await callApi(`/api/v1/admin/moderation/${item.id}`, { body: { decision, ...(decision === "return" ? { reason, comment: comment.trim() || undefined } : {}) } });
    setBusy(false);
    if (!r.ok) return setError(r.error?.fields?.reason || r.error?.message || "Не получилось сохранить решение.");
    onDone(decision === "approve" ? `Фото из заказа ${item.orderNumber} одобрено${r.waiting ? "" : " — заказ ушёл в производство"}.` : `Фото из заказа ${item.orderNumber} возвращено на замену.`);
  }

  return (
    <section className="card stack" data-testid="moderation-item">
      <div className="row between wrap">
        <b>
          Заказ {item.orderNumber} · фото № {(item.photoIndex ?? 0) + 1}
        </b>
        <span className="muted small">ждёт с {minskTime(item.createdAt)}</span>
      </div>
      <button type="button" className="btn btn-small" onClick={() => setShow((v) => !v)} aria-pressed={show}>
        {show ? "Скрыть фото" : "Показать фото"}
      </button>
      {item.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка на 10 минут, оптимизатор не нужен
        <img src={item.url} alt={`Фото на проверке, заказ ${item.orderNumber}`} style={{ width: "100%", maxWidth: 360, borderRadius: 8, filter: show ? "none" : "blur(24px)" }} />
      ) : (
        <p className="muted small">Файл фото недоступен.</p>
      )}
      <p className="small" style={{ margin: 0 }}>
        Классификатор: откровенное {pct((item.scores?.porn || 0) + (item.scores?.hentai || 0))}, «sexy» {pct(item.scores?.sexy)} · клиент {item.client?.name || "—"}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {mode === "return" ? (
        <div className="stack">
          <label className="field">
            <span>Причина (обязательно)</span>
            <select className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={!!error && !reason}>
              <option value="">— выберите —</option>
              {Object.entries(RETURN_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Комментарий для клиента (по желанию)</span>
            <textarea className="input" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
          </label>
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={() => decide("return")} disabled={busy}>
              {busy ? "Сохраняем…" : "Вернуть на замену"}
            </button>
            <button type="button" className="btn" onClick={() => setMode(null)} disabled={busy}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={() => decide("approve")} disabled={busy}>
            {busy ? "Сохраняем…" : "Одобрить"}
          </button>
          <button type="button" className="btn" onClick={() => setMode("return")} disabled={busy}>
            Вернуть на замену
          </button>
        </div>
      )}
    </section>
  );
}

export default function ModerationQueue() {
  const [res, setRes] = useState(null);
  const [note, setNote] = useState("");
  const load = useCallback(async () => setRes(await callApi("/api/v1/admin/moderation", { method: "GET" })), []);
  useEffect(() => {
    let alive = true;
    const tick = () => alive && load();
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load]);

  if (!res) return <p className="muted">Загружаем очередь…</p>;
  if (!res.ok) return <p className="error-text">{res.error?.message || "Не получилось загрузить очередь."}</p>;
  return (
    <div className="stack" data-testid="moderation-queue">
      {note && (
        <p className="ok-text" role="status">
          {note}
        </p>
      )}
      {!res.items.length && <p className="muted">Очередь пуста — все фото проверены.</p>}
      {res.items.map((it) => (
        <Card
          key={it.id}
          item={it}
          onDone={(text) => {
            setNote(text);
            load();
          }}
        />
      ))}
    </div>
  );
}
