"use client";
// Профиль: выключатель «Улучшать автоматически» (тот же, что в редакторе фото)
import { setAutoEnhance, useAutoEnhance } from "../lib/photo/settings";

export default function AutoEnhanceSetting() {
  const on = useAutoEnhance();
  return (
    <section className="card">
      <h3>Редактор фото</h3>
      <label className="row between pe-switch">
        <span>
          <b>Улучшать автоматически</b>
          <span className="muted small" style={{ display: "block" }}>
            Тёмные, пересвеченные и «цветные» фото мягко поправим при добавлении. Оригинал не меняется — улучшение можно отменить в редакторе.
          </span>
        </span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => setAutoEnhance(e.target.checked)} aria-label="Улучшать автоматически" />
      </label>
    </section>
  );
}
