"use client";
// Сезонная промо-плашка (N2) — над первым экраном главной. Цвета — только токены сезона (--season-*), текст — --season-ink на --season-bg (AA).
// Место под сезонный промокод N8: проп code (строка) или children — их плашка покажет справа от текста.
// «Без сезона» — плашки нет.
import Link from "next/link";
import { useSeason } from "@/lib/season";
import { SeasonIcon } from "./SeasonArt";
import { SEASON_COPY } from "./seasonCopy";

export default function SeasonPromo({ initial = "none", code = null, children = null, link = "#season" }) {
  const season = useSeason(initial);
  const copy = SEASON_COPY[season];
  if (!copy) return null;
  return (
    <aside className={`season-promo season-palette-${season}`} data-testid="season-promo" data-for={season} aria-label="Сезонное предложение">
      <SeasonIcon season={season} className="season-art season-icon" />
      <p className="season-promo-text">
        {copy.promo}
        {code && (
          <>
            {" "}
            Промокод <b className="season-code">{code}</b>
          </>
        )}
      </p>
      {children && <span className="season-promo-slot">{children}</span>}
      {link && (
        <Link href={link} className="season-promo-link">
          Смотреть
        </Link>
      )}
    </aside>
  );
}
