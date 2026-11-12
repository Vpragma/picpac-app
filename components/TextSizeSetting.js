"use client";
// Профиль: выключатель «Крупный текст» (настройка устройства — нужна и гостю)
import { setLargeText, useLargeText } from "../lib/textSize";

export default function TextSizeSetting({ initial = false }) {
  const on = useLargeText(initial);
  return (
    <section className="card" aria-labelledby="text-size-title">
      <h3 id="text-size-title">Удобство</h3>
      <label className="row between switch-row">
        <span>
          <b>Крупный текст</b>
          <span className="muted small" style={{ display: "block" }}>
            Всё станет крупнее на четверть. Настройка сохранится на этом устройстве.
          </span>
        </span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => setLargeText(e.target.checked)} aria-label="Крупный текст" />
      </label>
    </section>
  );
}
