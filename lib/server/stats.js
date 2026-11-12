import "server-only";
// Сводка для дашборда админки: база считает агрегаты (public.analytics_summary), приложение — проценты и медианы.
import { buildFunnel, buildSteps, pct, sourceLabel } from "@/lib/analyticsCore";
import { createSupabaseAdmin } from "./supabaseAdmin";

export const PERIODS = [7, 30];

export function parseStatsQuery(params) {
  const days = Number(params?.days) === 30 ? 30 : 7;
  const source = params?.source === "real" ? "real" : "all";
  return { days, source };
}

export async function loadStats({ days, source }) {
  const { data, error } = await createSupabaseAdmin().rpc("analytics_summary", { _days: days, _with_synthetic: source !== "real" });
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
  };
}
