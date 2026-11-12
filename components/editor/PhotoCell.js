"use client";
// Ячейка сетки фото на шаге «Фото» (вынесена из app/editor/page.js, N5): одна разметка и для сетки без перетаскивания
// (пока грузится @dnd-kit), и для сетки с перетаскиванием (components/editor/SortablePhotos.js) — подмена без сдвига вёрстки.
import { movePhoto, removePhoto } from "../../lib/draft";
import { IconLeft, IconRight, IconTrash } from "../icons";

// Загрузка фото в аккаунт (X-5, только у вошедшего клиента): «Загружено», «Загружается», «Ждёт сети»
const UPLOAD_LABELS = { done: "Загружено", sending: "Загружается", waiting: "Ждёт сети" };

export default function PhotoCell({ p, i, n, thumb, readOnly, badges, upload, cellRef, style, dragging = false, handleRef, handleProps }) {
  return (
    <div ref={cellRef} style={style} className={"photo-cell" + (dragging ? " dragging" : "")} data-photo={p.name}>
      {/* eslint-disable-next-line @next/next/no-img-element -- фото клиента с устройства (blob:/data:): next/image их не оптимизирует, оптимизатор Vercel для фото клиентов не используем */}
      {thumb ? <img src={thumb} alt={p.name} /> : <div className="bad">{p.supported ? "…" : p.tooBig ? "Больше 25 МБ" : p.tooManyPixels ? "Больше 100 Мп" : "Формат не подходит"}</div>}
      <span className="num">{i + 1}</span>
      {upload && (
        <span className={"photo-upload photo-upload-" + upload} data-upload={upload}>
          {UPLOAD_LABELS[upload]}
        </span>
      )}
      {badges?.length > 0 && (
        <span className="pe-badges compact" aria-label={"Фото " + (i + 1) + ": " + badges.map((b) => b.label).join(", ")}>
          {badges.map((b) => (
            <span key={b.id} className={"pe-badge " + b.tone} data-badge={b.id} title={b.label}>
              {b.short || b.label}
            </span>
          ))}
        </span>
      )}
      {!readOnly && (
        <>
          <button ref={handleRef} className="drag-handle" {...handleProps} aria-label={`Переставить фото ${i + 1} «${p.name}»`} title="Перетащите, чтобы переставить">
            ⠿
          </button>
          <div className="photo-tools">
            <button onClick={() => movePhoto(p.id, -1)} disabled={i === 0} aria-label={`Раньше: фото ${i + 1} «${p.name}»`} title="Раньше">
              <IconLeft size={18} />
            </button>
            <button onClick={() => removePhoto(p.id)} aria-label={`Удалить фото ${i + 1} «${p.name}»`} title="Удалить">
              <IconTrash size={16} />
            </button>
            <button onClick={() => movePhoto(p.id, 1)} disabled={i === n - 1} aria-label={`Позже: фото ${i + 1} «${p.name}»`} title="Позже">
              <IconRight size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Общие данные ячеек для обеих сеток: плашки, статус загрузки
export function cellProps({ draft, thumbs, readOnly, lowDpi, dups, syncEnabled, online, photoBadges }) {
  return draft.photos.map((p, i) => ({
    p,
    i,
    n: draft.photos.length,
    thumb: thumbs[p.id],
    readOnly,
    badges: photoBadges(p, { lowDpi: lowDpi?.has(p.id), duplicate: dups?.has(p.id) }),
    upload: syncEnabled && p.supported && draft.status !== "ordered" ? (p.serverId ? "done" : online ? "sending" : "waiting") : null,
  }));
}
