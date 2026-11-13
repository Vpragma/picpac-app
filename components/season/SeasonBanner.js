"use client";
// Сезонный баннер на главной (N2): «Осень в фотокниге», «Чёрная пятница», «Новый год в фотокниге».
// Стоит после первого экрана — LCP главной (текст первого экрана) не меняется; фото коллажа — ленивые, с размерами.
// Цвета — только --season-* (app/season.css); кнопка — фирменная. «Без сезона» — баннера нет.
// Листопад — только у осени и только внутри баннера; при prefers-reduced-motion листья не двигаются.
import Link from "next/link";
import { useSeason } from "@/lib/season";
import { LEAF_D, MAPLE_D } from "./SeasonArt";
import { SceneLayer } from "./SeasonScenes";
import { SEASON_COPY } from "./seasonCopy";

const LEAVES = ["leaf", "maple", "leaf", "leaf", "maple", "leaf", "leaf"];

function FallingLeaves() {
  return (
    <div className="sb-leaves" aria-hidden="true">
      {LEAVES.map((kind, i) =>
        kind === "maple" ? (
          <svg key={i} className="sb-leaf" viewBox="0 0 100 100" focusable="false">
            <path d={MAPLE_D} />
          </svg>
        ) : (
          <svg key={i} className="sb-leaf" viewBox="0 0 40 40" focusable="false">
            <path d={LEAF_D} />
            <path d="M6 34 L27 13" />
          </svg>
        ),
      )}
    </div>
  );
}

export default function SeasonBanner({ initial = "none", photos = {} }) {
  const season = useSeason(initial);
  const copy = SEASON_COPY[season];
  if (!copy) return null;
  const prints = photos[season] || [];
  return (
    <section id="season" className={`season-banner season-palette-${season}`} data-testid="season-banner" data-for={season} aria-labelledby="season-title">
      {season === "autumn" && <FallingLeaves />}
      <div className="sb-text">
        <p className="sb-eyebrow">{copy.eyebrow}</p>
        <h2 id="season-title" className="sb-title">
          {copy.title}
        </h2>
        <p className="sb-lead">{copy.text}</p>
        <Link href="#catalog" className="btn btn-primary btn-lg">
          {copy.cta}
        </Link>
      </div>
      <div className={"sb-media" + (prints.length ? "" : " sb-media-art")}>
        <SceneLayer season={season} layer="back" />
        {prints.map((p) => (
          <figure key={p.cls} className={"sb-print " + p.cls}>
            <picture>
              <img {...p.img} alt="" decoding="async" />
            </picture>
          </figure>
        ))}
        <SceneLayer season={season} layer="front" />
      </div>
    </section>
  );
}
