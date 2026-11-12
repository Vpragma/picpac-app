// GET /api/v1/season → { season: "none" | "autumn" | "blackfriday" | "newyear" } (N2, договор docs/night/night2-seasons.md).
// Публично, без входа. Короткий кэш (5 с): смена сезона в админке доходит до всех клиентов за секунды.
// Нет ответа базы — «none»: сезонных элементов нет, всё работает.
import { readSeason } from "@/lib/server/season";

export async function GET() {
  const season = await readSeason({ maxAgeMs: 3000 });
  return Response.json({ season }, { headers: { "Cache-Control": "public, max-age=5, s-maxage=5" } });
}
