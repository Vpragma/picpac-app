"use client";
// Демо модерации (A2): обычные фото классификатор не помечает, поэтому для показа жюри — кнопка
// «Отправить фото на модерацию». Видна админу, аккаунтам жюри и тестовым (GET /api/v1/me → testTools).
// Ставит фото оценки «подозрительно» — дальше весь настоящий путь: плашка → очередь → решение → уведомление клиенту.
import { useEffect, useState } from "react";
import { callApi } from "../lib/api";
import { updateProjectMeta } from "../lib/draft";
import { getMe } from "../lib/me";

// Пометка «для показа модерации»: модератор увидит «Демо: фото помечено вручную…», а не выдуманную находку модели
const FLAG = { v: 2, demo: 1 };

export default function ModerationDemoButton({ draft }) {
  const [tools, setTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let alive = true;
    getMe().then((m) => alive && setTools(!!m?.authenticated && !!m.testTools));
    return () => {
      alive = false;
    };
  }, []);
  const target = (draft?.photos || []).find((p) => p.supported && !p.moderationFlag);
  if (!tools || !draft || draft.status === "ordered" || (!target && !msg)) return null;

  async function send() {
    if (busy || !target) return;
    setBusy(true);
    setMsg("");
    updateProjectMeta(draft.id, (x) => ({ ...x, photos: x.photos.map((y) => (y.id === target.id ? { ...y, nsfw: FLAG, moderationFlag: true } : y)) }));
    if (draft.serverId && target.serverId) {
      const r = await callApi(`/api/v1/projects/${draft.serverId}/photos/${target.serverId}`, { method: "PATCH", body: { nsfw: FLAG } });
      if (!r.ok) {
        setBusy(false);
        return setMsg(r.error?.message || "Не получилось отправить фото на модерацию. Попробуйте ещё раз.");
      }
    }
    setBusy(false);
    setMsg("Готово: фото помечено. После оформления заказ подождёт модератора (админка → «Модерация»).");
  }

  return (
    <div className="card stack" data-testid="moderation-demo">
      <p className="small muted" style={{ margin: 0 }}>
        Демо для жюри: проверка на устройстве не нашла ничего подозрительного. Пометьте одно фото, чтобы показать путь модерации: плашка → очередь → «Одобрить» или «Вернуть на замену» → уведомление клиенту.
      </p>
      {target && (
        <button type="button" className="btn btn-small" onClick={send} disabled={busy}>
          {busy ? "Отправляем…" : "Отправить фото на модерацию (демо)"}
        </button>
      )}
      {msg && (
        <p className="small" role="status" style={{ margin: 0 }}>
          {msg}
        </p>
      )}
    </div>
  );
}
