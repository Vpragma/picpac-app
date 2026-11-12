// GET /api/v1/admin/stats?days=1|7|30|90&source=all|real — сводка дашборда (N9: + промокоды promo). Только для роли admin.
// Права проверяются дважды: в proxy.js и здесь. Без входа — 401, без роли admin — 403.
import { json, jsonError } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";
import { loadStats, parseStatsQuery } from "@/lib/server/stats";

export async function GET(request) {
  const { response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  const q = parseStatsQuery(Object.fromEntries(new URL(request.url).searchParams));
  try {
    return json({ ok: true, timezone: "Europe/Minsk", ...(await loadStats(q)) });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "stats_unavailable", "Не получилось посчитать статистику. Попробуйте ещё раз.");
  }
}
