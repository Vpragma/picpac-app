"use client";
// Цифровая открытка после заказа (N8, идея брендбука: PicPac кладёт открытки со скидкой в каждый заказ).
// Личный код на следующий заказ выдаёт сервер вместе с заказом (один на заказ, повторный показ нового не создаёт).
// «Сохранить картинкой» рисует ту же открытку на canvas и сохраняет PNG — всё на устройстве, без сторонних сервисов.
import { useEffect, useState } from "react";
import { benefitText, promoDate } from "../../lib/promo";
import { ART, BRAND_COLORS, CARD_H, CARD_W, cardText, drawCard, seasonColors, spaced } from "./postcardArt";
import "./promo.css";

export default function Postcard({ card, orderNumber, compact = false }) {
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState(null);

  useEffect(() => {
    // Сезонное оформление линий — если сезон включён (N2 ставит data-season на <html>)
    const read = () => setSeason(seasonColors());
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-season"] });
    return () => mo.disconnect();
  }, []);

  if (!card) return null;
  const data = { code: card.code, benefit: benefitText(card), validToText: promoDate(card.validTo), orderNumber };
  const t = cardText(data);
  const c = { ...BRAND_COLORS, ...(season || {}) };
  const label = `Открытка PicPac. ${t.title.join(" ")}. ${t.body.join(" ")} ${t.codeLabel}: ${card.code}. ${t.terms}.`;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const canvas = await drawCard(document.createElement("canvas"), data, season);
      const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("png"))), "image/png"));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `picpac-otkrytka-${card.code}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMsg({ ok: true, text: "Открытка сохранена картинкой." });
    } catch {
      setMsg({ ok: false, text: "Не получилось сохранить картинку. Сделайте снимок экрана — код останется в «Мои заказы»." });
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(card.code);
      setMsg({ ok: true, text: `Код ${card.code} скопирован.` });
    } catch {
      setMsg({ ok: false, text: `Не получилось скопировать. Код: ${card.code}` });
    }
  }

  const status =
    card.status === "used" ? "Код уже использован в другом заказе." : card.status === "expired" ? "Срок кода закончился." : card.status === "disabled" ? "Код выключен." : null;

  return (
    <section className={"postcard" + (compact ? " postcard-compact" : "")} aria-labelledby="postcard-title" data-testid="postcard" data-code={card.code}>
      <h2 id="postcard-title" className="visually-hidden">
        Открытка с личным кодом
      </h2>
      <svg className="postcard-art" viewBox={`0 0 ${CARD_W} ${CARD_H}`} role="img" aria-label={label} data-season={season?.season || undefined}>
        <rect x="0" y="0" width={CARD_W} height={CARD_H} rx="22" fill={c.paper} />
        <rect x="14" y="14" width={CARD_W - 28} height={CARD_H - 28} rx="14" fill="none" stroke={c.frame} strokeWidth="1.5" />
        <g fill="none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          {ART.map((a, i) => (
            <path key={i} d={a.d} stroke={c[a.ink]} />
          ))}
        </g>
        <g textAnchor="middle" className="postcard-text">
          {t.title.map((line, i) => (
            <text key={line} x="200" y={246 + i * 31} fontSize="25" fontWeight="500" fill={c.text}>
              {line}
            </text>
          ))}
          {t.body.map((line, i) => (
            <text key={line} x="200" y={312 + i * 21} fontSize="15" fill={c.muted}>
              {line}
            </text>
          ))}
          <rect x="44" y="352" width="312" height="92" rx="14" fill={c.codeBg} stroke={c.code} strokeWidth="1.6" strokeDasharray="6 5" />
          <text x="200" y="376" fontSize="13" fill={c.muted}>
            {t.codeLabel}
          </text>
          <text x="200" y="420" fontSize="30" fontWeight="500" fill={c.code} data-testid="postcard-code">
            {spaced(card.code)}
          </text>
          <text x="200" y="470" fontSize="16" fontWeight="500" fill={c.text}>
            {t.terms}
          </text>
          <text x="200" y="492" fontSize="13" fill={c.muted}>
            {t.note}
          </text>
          <text x="200" y="512" fontSize="12" fill={c.muted}>
            {t.slogan}
          </text>
        </g>
      </svg>
      {status && <p className="note note-warn small">{status}</p>}
      <div className="postcard-actions">
        <button type="button" className="btn btn-secondary" onClick={save} disabled={busy} aria-busy={busy}>
          {busy ? "Рисуем открытку…" : "Сохранить картинкой"}
        </button>
        <button type="button" className="btn" onClick={copy}>
          Скопировать код
        </button>
      </div>
      {msg && (
        <p className={"note small " + (msg.ok ? "note-ok" : "note-error")} role="status">
          {msg.text}
        </p>
      )}
    </section>
  );
}

// Короткая строка для списка «Мои заказы»: код, выгода, срок, статус
export function CardLine({ card }) {
  if (!card) return null;
  const state = card.status === "used" ? "использован" : card.status === "expired" ? "срок закончился" : card.status === "disabled" ? "выключен" : `до ${promoDate(card.validTo)}`;
  return (
    <div className="card-line small" data-testid="order-card-code">
      <span>Открытка: код на следующий заказ</span> <span className="chip chip-ok">{card.code}</span> <span className="muted">{benefitText(card)} · {state}</span>
    </div>
  );
}
