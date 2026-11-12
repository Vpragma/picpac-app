"use client";
// Сезонная плашка с действующим промокодом (N8) — на главной и в корзине.
// Сезон — из GET /api/v1/season (N2, договор docs/night/night2-seasons.md) или из data-season на <html>.
// Нет маршрута, нет ответа или «none» — плашки нет, ничего не ломается. Код — из GET /api/v1/promo/seasonal: только включённый, в сроке, нужного сезона.
// Цвета — --season-*, если N2 их задал, иначе фирменная пастель (app/picpac.css).
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_ROUTES } from "../../lib/apiRoutes";
import { benefitText, promoDate } from "../../lib/promo";
import "./promo.css";

// Маршрут сезона появляется вместе с N2: пока его нет в сборке — не спрашиваем (без 404 в консоли)
const HAS_SEASON_API = API_ROUTES.some((r) => new RegExp(r.pattern).test("/api/v1/season"));

const TITLES = {
  autumn: "Осень в фотокниге",
  blackfriday: "Чёрная пятница в PicPac",
  newyear: "Новогодние воспоминания",
};

async function getJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default function SeasonPromo({ place = "home", applied = null, onApply = null }) {
  const [promo, setPromo] = useState(null);

  useEffect(() => {
    let alive = true;
    // Быстрый путь: N2 ставит data-season на <html> на сервере — тогда запрос сезона не нужен
    const attr = document.documentElement.getAttribute("data-season");
    if (attr === "none" || (!attr && !HAS_SEASON_API)) return;
    (async () => {
      const season = TITLES[attr] ? attr : (await getJson("/api/v1/season"))?.season;
      if (!season || season === "none" || !TITLES[season]) return;
      const r = await getJson(`/api/v1/promo/seasonal?season=${encodeURIComponent(season)}`);
      if (alive && r?.promo) setPromo({ ...r.promo, season });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!promo) return null;
  const until = promo.validTo ? ` до ${promoDate(promo.validTo)}` : "";
  return (
    <aside className="season-promo" data-season-promo={promo.season} data-testid="season-promo" aria-label="Сезонный промокод">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M6 30 C10 18 18 10 30 6 C28 18 20 26 6 30 Z" />
        <path d="M6 30 L22 14" />
        <path d="M13 24 L13 18 M18 19 L18 13 M13 24 L19 24 M18 19 L24 19" />
      </svg>
      <div className="season-promo-text">
        <b>{TITLES[promo.season]}</b>
        <span>
          {promo.label || benefitText(promo)} по коду <span className="season-promo-code">{promo.code}</span>
          {until}
        </span>
      </div>
      {place === "cart" && onApply ? (
        applied === promo.code ? (
          <span className="chip chip-ok">Код применён</span>
        ) : (
          <button type="button" className="btn btn-small" onClick={() => onApply(promo.code)}>
            Использовать {promo.code}
          </button>
        )
      ) : (
        <Link href="/#catalog" className="btn btn-small">
          Выбрать книгу
        </Link>
      )}
    </aside>
  );
}
