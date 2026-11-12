// Карточка продукта. Каталог берём на сервере (тот же источник, что GET /api/v1/catalog) —
// страница приходит уже с ценой и сроками, без «Загружаем…».
import { notFound } from "next/navigation";
import { loadCatalog } from "@/lib/server/catalog";
import { minskDate } from "@/lib/pricing";
import ProductView from "@/components/ProductView";

export const revalidate = 60;

async function safeCatalog() {
  try {
    return await loadCatalog();
  } catch (e) {
    console.error(e?.message);
    return null;
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const p = (await safeCatalog())?.products.find((x) => x.slug === slug);
  if (!p) return { title: "Продукт — PicPac" };
  return { title: `${p.kind === "book" ? "Фотокнига " : ""}${p.name} — PicPac`, description: p.tagline };
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const catalog = await safeCatalog();
  // Каталог загрузился, а такого продукта нет — настоящая 404 (раньше был код 200 и текст «не найден»)
  if (catalog && !catalog.products.some((p) => p.slug === slug)) notFound();
  return <ProductView slug={slug} initial={catalog} serverToday={minskDate()} />;
}
