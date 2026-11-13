import "server-only";
// Сводка для дашборда админки: база считает агрегаты (public.analytics_summary), приложение — проценты и медианы.
import { buildFunnel, buildSteps, pct, sourceLabel } from "@/lib/analyticsCore";
import { queueCounts } from "./moderationCounts";
import { createSupabaseAdmin } from "./supabaseAdmin";

// N9: период — сутки, 7, 30 или 90 дней (база считает за любое число дней)
export const PERIODS = [1, 7, 30, 90];

export function parseStatsQuery(params) {
  const d = Number(params?.days);
  const days = PERIODS.includes(d) ? d : 7;
  const source = params?.source === "real" ? "real" : "all";
  return { days, source };
}

// N9: промокоды за период — по заказам (orders.promo_code, discount_kop): сколько заказов с кодом, доля,
// сумма скидок, самые частые коды. Синтетика — по тому же переключателю, что и вся статистика.
export async function loadPromoStats(db, { days, source }) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const base = () => {
    let q = db.from("orders").select("id", { count: "exact", head: true }).gte("created_at", since);
    if (source === "real") q = q.eq("is_synthetic", false);
    return q;
  };
  const [all, withCode] = await Promise.all([base(), base().not("promo_code", "is", null)]);
  if (all.error || withCode.error) throw new Error("Промокоды: " + (all.error || withCode.error).message);
  const rows = [];
  for (let from = 0; from < 10_000; from += 1000) {
    let q = db.from("orders").select("promo_code, discount_kop").gte("created_at", since).not("promo_code", "is", null).order("created_at").range(from, from + 999);
    if (source === "real") q = q.eq("is_synthetic", false);
    const { data, error } = await q;
    if (error) throw new Error("Промокоды: " + error.message);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const byCode = new Map();
  for (const r of rows) {
    const c = byCode.get(r.promo_code) || { code: r.promo_code, orders: 0, discountKop: 0 };
    c.orders += 1;
    c.discountKop += r.discount_kop || 0;
    byCode.set(r.promo_code, c);
  }
  return {
    orders: all.count || 0,
    withCode: withCode.count || 0,
    sharePct: pct(withCode.count || 0, all.count || 0),
    discountKop: rows.reduce((s, r) => s + (r.discount_kop || 0), 0),
    top: [...byCode.values()].sort((a, b) => b.orders - a.orders || b.discountKop - a.discountKop).slice(0, 5),
  };
}

export async function loadStats({ days, source }) {
  const db = createSupabaseAdmin();
  const [{ data, error }, promo, moderation] = await Promise.all([
    db.rpc("analytics_summary", { _days: days, _with_synthetic: source !== "real" }),
    loadPromoStats(db, { days, source }).catch((e) => {
      console.error(e?.message);
      return null;
    }),
    // N7: фото в очереди модератора — тот же счётчик, что в «Обзоре» и в очереди (синтетика фото не имеет)
    queueCounts(db).catch((e) => {
      console.error(e?.message);
      return null;
    }),
  ]);
  if (error) throw new Error("Сводка: " + error.message);
  const s = data || {};
  const funnel = buildFunnel(s.funnel);
  const steps = buildSteps(s.durations, s.dropoff);
  const ai = s.ai || {};
  return {
    days,
    source,
    label: sourceLabel(s),
    tiles: { ...(s.tiles || {}), unanswered: s.unanswered || 0, unansweredOverdue: s.unansweredOverdue || 0 },
    funnel,
    steps,
    ai: { ...ai, projectsWithAiPct: pct(ai.projectsWithAi || 0, ai.projects || 0) },
    events: s.events || 0,
    synthetic: s.synthetic || { events: 0, orders: 0 },
    promo,
    moderation,
  };
}
