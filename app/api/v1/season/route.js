// GET /api/v1/season → { season: "none" | "autumn" | "blackfriday" | "newyear" } (N2, договор docs/night/night2-seasons.md).
// Публично, без входа. Короткий кэш (5 с): смена сезона в админке доходит до всех клиентов за секунды.
// Запрос с cookies входа (sb-…) — без общего кэша: proxy.js может обновить сессию и добавить Set-Cookie к этому ответу.
// Нет ответа базы — «none»: сезонных элементов нет, всё работает.
import { readSeason } from "@/lib/server/season";

export async function GET(request) {
  const season = await readSeason();
  const withSession = /(?:^|;\s*)sb-/.test(request.headers.get("cookie") || "");
  return Response.json({ season }, { headers: { "Cache-Control": withSession ? "private, no-store" : "public, max-age=5, s-maxage=5" } });
}
