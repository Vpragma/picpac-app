// GET /api/v1/promo/seasonal?season=autumn — действующий сезонный промокод для плашки на главной и в корзине (N8).
// Сезон экран берёт из GET /api/v1/season (N2). Код показываем, только если он включён, не личный, срок идёт
// и сезон совпадает. Нет кода — { promo: null }. Открыт всем, кэш CDN — 60 секунд.
import { benefitText, promoDate, publicPromo, SEASON_LABELS, SEASONS, shapePromo } from "@/lib/promo";
import { jsonError } from "@/lib/server/http";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" };

export async function GET(request) {
  const season = new URL(request.url).searchParams.get("season") || "";
  if (!SEASONS.includes(season)) return Response.json({ ok: true, season: season || "none", promo: null }, { headers: CACHE });
  try {
    const t = Date.now();
    const { data, error } = await createSupabaseAdmin()
      .from("promo_codes")
      .select("*")
      .eq("season", season)
      .eq("active", true)
      .is("owner_user_id", null)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    const row = (data || []).find((r) => (!r.valid_from || new Date(r.valid_from).getTime() <= t) && (!r.valid_to || new Date(r.valid_to).getTime() >= t));
    const p = shapePromo(row);
    // Лимит «всего» исчерпан — не зовём клиента к коду, который не сработает
    if (p?.maxUses != null) {
      const { count } = await createSupabaseAdmin().from("promo_redemptions").select("id", { count: "exact", head: true }).eq("code", p.code);
      if ((count || 0) >= p.maxUses) return Response.json({ ok: true, season, promo: null }, { headers: CACHE });
    }
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
