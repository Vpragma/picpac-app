// GET /api/v1/promo/seasonal?season=autumn — действующий сезонный промокод для плашки на главной и в корзине (N8).
// Сезон экран берёт из GET /api/v1/season (N2). Код показываем, только если он включён, не личный, срок идёт
// и сезон совпадает. Нет кода — { promo: null }. Открыт всем, кэш CDN — 60 секунд.
import { benefitText, promoDate, publicPromo, SEASON_LABELS, SEASONS } from "@/lib/promo";
import { jsonError } from "@/lib/server/http";
import { findSeasonalPromo } from "@/lib/server/promo";

const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };

export async function GET(request) {
  const season = new URL(request.url).searchParams.get("season") || "";
  if (!SEASONS.includes(season)) return Response.json({ ok: true, season: season || "none", promo: null }, { headers: CACHE });
  try {
    const p = await findSeasonalPromo(season);
    return Response.json(
      {
        ok: true,
        season,
        seasonLabel: SEASON_LABELS[season],
        promo: p ? { ...publicPromo(p), benefit: benefitText(p), validToText: promoDate(p.validTo) } : null,
      },
      { headers: CACHE },
    );
  } catch (e) {
    console.error(e?.message);
    return jsonError(503, "promo_unavailable", "Сезонный промокод сейчас не загрузился. Попробуйте позже.");
  }
}
