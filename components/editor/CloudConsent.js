"use client";
// Согласие на облачный ИИ (D6, SEC-20): один раз на аккаунт, понятным текстом — что, куда, не хранится.
// Без согласия сервер облако не вызывает (403). «Не сейчас» — правки на телефоне работают как раньше.
import { useState } from "react";
import { giveConsent } from "../../lib/cloudAi/client";
import { CLOUD_LIMITS, CONSENT_TEXT } from "../../lib/cloudAi/shared";

export default function CloudConsent({ ask, onAllow, onClose }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!ask) return null;

  async function allow() {
    if (busy) return;
    setBusy(true);
    setErr("");
    const r = await giveConsent();
    setBusy(false);
    if (!r.ok) return setErr(r.say);
    onClose();
    onAllow();
  }

  return (
    <section className="card pe-cloud" aria-labelledby="pe-cloud-title" data-cloud-consent style={{ marginTop: 12, display: "grid", gap: 8 }}>
      <b id="pe-cloud-title">Облачный ИИ</b>
      <p className="small">
        {ask.why}. {CONSENT_TEXT} Уходит только уменьшенная копия фото без данных о месте съёмки и имени файла, обрабатывает Cloudflare (США). До {CLOUD_LIMITS.perUserDay} облачных правок в день, остальные правки работают на телефоне.
      </p>
      {err && (
        <p className="small" role="alert" style={{ color: "var(--ds-color-error)", margin: 0 }}>
          {err}
        </p>
      )}
      <div className="row wrap" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={allow} disabled={busy} aria-busy={busy}>
          {busy ? "Сохраняем…" : "Разрешить"}
        </button>
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          Не сейчас
        </button>
      </div>
    </section>
  );
}
