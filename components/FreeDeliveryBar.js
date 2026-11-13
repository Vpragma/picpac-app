"use client";
// Корзина: «до бесплатной доставки» — сколько осталось до порога Белпочты и EMS (день 3, задача 1).
// Расчёт — lib/freeDelivery.js; сумма — та же, по которой итог решает, что доставка бесплатна.
import { useEffect, useState } from "react";
import { freeDeliveryMessage, freeDeliveryProgress } from "../lib/freeDelivery";
import { formatByn } from "../lib/pricing";

export default function FreeDeliveryBar({ methods, afterDiscountKop, freeByPromo = false, promoCode = "" }) {
  const p = freeDeliveryProgress(methods, afterDiscountKop, freeByPromo);
  const m = freeDeliveryMessage(p, promoCode);
  const pct = p ? Math.round(Math.min(1, Math.max(0, p.fill)) * 100) : 0;
  // Полоса заполняется плавно: сначала пустая, на следующем кадре — до нужной ширины (при «уменьшить движение» — сразу, см. CSS)
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  if (!m) return null;
  const text = (m.ok ? "✓ " : "") + m.before + (m.amountKop != null ? formatByn(m.amountKop) : "");
  return (
    <section className="card free-ship" data-testid="free-delivery" data-state={p.state} aria-label="Бесплатная доставка">
      <p className={"free-ship-text" + (m.ok ? " ok" : "")} data-testid="free-delivery-text">
        {m.ok && <span aria-hidden="true">✓ </span>}
        {m.before}
        {m.amountKop != null && <b className="free-ship-left">{formatByn(m.amountKop)}</b>}
      </p>
      <div className={"free-ship-track" + (m.ok ? " ok" : "")} role="progressbar" aria-label="До бесплатной доставки" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={text}>
        <div className="free-ship-fill" style={{ width: shown + "%" }} />
      </div>
    </section>
  );
}
