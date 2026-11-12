"use client";
// Админка → «Сезон» (N2): четыре варианта с превью и кнопка «Включить». Права проверяет сервер (только admin), смена — в журнале.
import Link from "next/link";
import { useState } from "react";
import { callApi } from "@/lib/api";
import { applySeason } from "@/lib/season";
import { SEASONS, SEASON_LABELS, SEASON_PALETTES } from "@/lib/seasonShared";
import LineArt from "@/components/LineArt";
import { SceneLayer } from "@/components/season/SeasonScenes";
import { SEASON_COPY } from "@/components/season/seasonCopy";

const NOTES = {
  none: "Сезонных элементов нет — только фирменный стиль.",
  autumn: "Охра, терракота, бордо: листья, рябина, кружка и плед; в баннере — листопад.",
  blackfriday: "Почти чёрный фон, красный и персиковый: ценники и покупки.",
  newyear: "Глубокий зелёный и золото: хвоя, шары, снежинки и подарки.",
};

const when = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Minsk" }) : null);

function Preview({ season }) {
  if (season === "none")
    return (
      <div className="season-preview season-palette-none">
        <p className="season-preview-title">Фирменный стиль Pic Pac</p>
        <div className="season-preview-art">
          <LineArt name="book" />
        </div>
      </div>
    );
  const pal = SEASON_PALETTES[season];
  return (
    <div className={`season-preview season-palette-${season}`}>
      <div>
        <p className="season-preview-title">{SEASON_COPY[season].title}</p>
        <ul className="season-swatches" aria-label="Палитра сезона" style={{ marginTop: 8 }}>
          {[1, 2, 3, 4, 5].map((k) => (
            <li key={k} style={{ background: pal[k] }} />
          ))}
        </ul>
      </div>
      <div className="season-preview-art">
        <SceneLayer season={season} layer="back" />
        <SceneLayer season={season} layer="front" />
      </div>
    </div>
  );
}

export default function SeasonPanel({ initial }) {
  const [current, setCurrent] = useState(initial.season);
  const [picked, setPicked] = useState(initial.season);
  const [meta, setMeta] = useState({ at: initial.updatedAt, by: initial.updatedBy, mine: false });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(initial.error ? { err: true, text: "Не получилось прочитать текущий сезон. Обновите страницу." } : null);

  async function save(e) {
    e.preventDefault();
    if (busy || picked === current) return;
    setBusy(true);
    setMsg(null);
    const r = await callApi("/api/v1/admin/season", { method: "PUT", body: { season: picked } });
    setBusy(false);
    if (!r.ok) {
      setMsg({ err: true, text: r.error?.message || "Не получилось сменить сезон. Попробуйте ещё раз." });
      return;
    }
    setCurrent(r.season);
    setMeta({ at: new Date().toISOString(), by: null, mine: true });
    applySeason(r.season);
    setMsg({
      err: false,
      text:
        r.season === "none"
          ? "Готово: сезон выключен. Клиенты увидят фирменный стиль без сезонных элементов — при открытии приложения или возврате на вкладку."
          : `Готово: включён сезон «${SEASON_LABELS[r.season]}». Клиенты увидят его при открытии приложения или возврате на вкладку.`,
    });
  }

  return (
    <form onSubmit={save} data-testid="season-panel">
      <div className="card season-current" data-testid="season-current">
        <span>Сейчас:</span>
        <span className="chip">{SEASON_LABELS[current]}</span>
        {meta.at && (
          <span className="muted small">
            включён {when(meta.at)}
            {meta.by ? ` · ${meta.by}` : meta.mine ? " · вами" : ""}
          </span>
        )}
      </div>
      <fieldset className="season-options">
        <legend className="visually-hidden">Сезон оформления</legend>
        {SEASONS.map((s) => (
          <label key={s} className="season-option" data-testid={`season-option-${s}`}>
            <input type="radio" name="season" value={s} checked={picked === s} onChange={() => setPicked(s)} />
            <span className="season-option-head">
              <span>
                {SEASON_LABELS[s]}
                {s === current && <span className="muted small"> · сейчас</span>}
              </span>
              <span className="season-option-mark" aria-hidden="true" />
            </span>
            <Preview season={s} />
            <span className={`season-logo-sample season-palette-${s}`}>логотип</span>
            <span className="season-option-note">{NOTES[s]}</span>
          </label>
        ))}
      </fieldset>
      <div className="row wrap" style={{ gap: 12, alignItems: "center" }}>
        <button type="submit" className="btn btn-primary" disabled={busy || picked === current}>
          {busy ? "Сохраняем…" : picked === current ? "Этот сезон уже включён" : `Включить «${SEASON_LABELS[picked]}»`}
        </button>
        <Link href="/" className="btn">
          Открыть главную
        </Link>
      </div>
      {msg && (
        <p role="status" className={"note " + (msg.err ? "note-error" : "note-ok")} style={{ marginTop: 12 }} data-testid="season-result">
          {msg.text}
        </p>
      )}
    </form>
  );
}
