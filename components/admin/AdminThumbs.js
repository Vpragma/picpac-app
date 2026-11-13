"use client";
// Миниатюры фото клиента на экранах сотрудников (N7, требование N4). Одно правило с очередью модерации:
// у фото с флагом модерации — размытие, вывод модели словами и «Показать» (по нажатию, для каждого фото отдельно).
// photos: [{ key, src, alt, flagged, findings: ["Найдено: …"] }]; src — подписанная ссылка на 10 минут.
import { useState } from "react";
import { BLUR_STYLE } from "./moderationBlur";

export default function AdminThumbs({ photos, label, more = 0 }) {
  const [shown, setShown] = useState({});
  const flagged = photos.filter((p) => p.flagged);
  const toggle = (key) => setShown((s) => ({ ...s, [key]: !s[key] }));
  return (
    <>
      <ul className="admin-thumbs" aria-label={label} data-testid="admin-order-thumbs">
        {photos.map((p) => {
          const blurred = p.flagged && !shown[p.key];
          return (
            <li key={p.key} data-flagged={p.flagged ? "true" : undefined}>
              {p.src ? (
                <span className="admin-thumb-frame">
                  {/* eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка на 10 минут на фото клиента, оптимизатор не нужен */}
                  <img
                    src={p.src}
                    alt={blurred ? `${p.alt}: скрыто размытием — флаг модерации` : p.alt}
                    width="72"
                    height="72"
                    loading="lazy"
                    data-blurred={p.flagged ? (blurred ? "true" : "false") : undefined}
                    style={blurred ? BLUR_STYLE : undefined}
                  />
                </span>
              ) : (
                <span className="admin-thumb-empty" title="Фото недоступно" />
              )}
            </li>
          );
        })}
        {more > 0 && <li className="muted small admin-thumbs-more">и ещё {more}</li>}
      </ul>
      {flagged.length > 0 && (
        <ul className="stack small admin-flagged" data-testid="admin-flagged-photos">
          {flagged.map((p) => (
            <li key={p.key} className="row wrap" style={{ gap: "var(--space-2)", alignItems: "center" }}>
              <span>
                <b>{p.alt}</b>: {p.findings.length ? p.findings.join("; ") : "модель ничего не нашла — фото помечено вручную или старой проверкой"}
              </span>
              {p.src && (
                <button type="button" className="btn btn-small" aria-pressed={!!shown[p.key]} onClick={() => toggle(p.key)} data-testid="staff-photo-show">
                  {shown[p.key] ? `Скрыть ${p.alt.toLowerCase()}` : `Показать ${p.alt.toLowerCase()}`}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
