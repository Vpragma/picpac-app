// /api/v1/admin/season (N2) — сезон оформления. Только администратор (роль проверяет сервер), каждая смена — в журнале.
// GET → { ok, season, updatedAt, updatedBy }; PUT { season } → { ok, season, previous }.
// Неверное значение — 400, гость — 401, клиент и модератор — 403 (отказ тоже пишется в журнал).
import { limitWrite, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { readSeasonInfo, writeSeason } from "@/lib/server/season";
import { SEASONS } from "@/lib/seasonShared";

const Body = z.strictObject({ season: z.enum(SEASONS, "Выберите один из сезонов: none, autumn, blackfriday, newyear.") });

export async function GET(request) {
  const { response } = await requireUser(request, ["admin"]);
  if (response) return response;
  try {
    return json({ ok: true, ...(await readSeasonInfo()) });
  } catch (e) {
    console.error("Сезон:", e?.message);
    return serverError();
  }
}

export async function PUT(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, Body);
  if (bad) return bad;
  const limited = await limitWrite("season", ctx.userId, 30);
  if (limited) return limited;
  try {
    const r = await writeSeason(body.season, ctx.userId);
    await ctx.audit("admin.season_set", "season", r.season, "success", { from: r.previous, to: r.season });
    return json({ ok: true, ...r });
  } catch (e) {
    console.error("Сезон: не удалось сменить", e?.message);
    await ctx.audit("admin.season_set", "season", body.season, "error", { to: body.season });
    return serverError();
  }
}
