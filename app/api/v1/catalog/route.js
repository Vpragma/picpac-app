// GET /api/v1/catalog — каталог из базы: продукты, размеры, опции, цены (копейки и BYN), сроки,
// требования к фото, способы доставки. Открыт всем, в том числе гостям. Кэш CDN — 60 секунд.
import { loadCatalog } from "@/lib/server/catalog";
import { jsonError } from "@/lib/server/http";

export async function GET() {
  try {
    const catalog = await loadCatalog();
    return Response.json(
      {
        ok: true,
        ...catalog,
        priceFormula: "цена книги = (база + надбавка_за_2_стр × (страниц − мин) / 2) × k_размера, округлено до 0,10; k = 1 + 0,6 × (площадь/400 − 1)",
        sizeNote: "Коэффициенты размеров тестовые — уточнить у Фотопринт",
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=600" } },
    );
  } catch (e) {
    console.error(e?.message);
    return jsonError(503, "catalog_unavailable", "Каталог временно недоступен. Обновите страницу через минуту.");
  }
}
