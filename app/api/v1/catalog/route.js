import { products, CATALOG_VERSION } from "../../../../lib/catalog";

// GET /api/v1/catalog — продукты PicPac с вариантами и ценами (BYN).
export async function GET() {
  return Response.json({
    version: CATALOG_VERSION,
    currency: "BYN",
    priceFormula: "цена = базовая_цена + надбавка_за_2_страницы × (страниц − минимум_страниц) / 2",
    products,
  });
}
