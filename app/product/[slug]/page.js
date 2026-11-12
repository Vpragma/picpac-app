// Карточка продукта. Каталог берём на сервере (тот же источник, что GET /api/v1/catalog) —
// страница приходит уже с ценой и сроками, без «Загружаем…».
import { notFound } from "next/navigation";
import { loadCatalog } from "@/lib/server/catalog";
import { minskDate } from "@/lib/pricing";
import ProductView from "@/components/ProductView";
import { ProductGallery } from "@/components/ProductPhoto";
import { productPhotos } from "@/lib/productPhotos";

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
  const catalog = await safeCatalog();
  const p = catalog?.products.find((x) => x.slug === slug);
  // Каталог загрузился, а продукта нет — вкладка называется как страница 404
  if (!p) return { title: catalog ? "Страница не найдена — PicPac" : "Продукт — PicPac" };
  return { title: `${p.kind === "book" ? "Фотокнига " : ""}${p.name} — PicPac`, description: p.tagline };
}

export default async function ProductPage({ params }) {
  const { slug } = await params;
  const catalog = await safeCatalog();
  // Каталог загрузился, а такого продукта нет — настоящая 404 (раньше был код 200 и текст «не найден»)
  if (catalog && !catalog.products.some((p) => p.slug === slug)) notFound();
  const p = catalog?.products.find((x) => x.slug === slug);
  const name = p ? `${p.kind === "book" ? "Фотокнига " : ""}${p.name}` : "продукт";
  return <ProductView slug={slug} initial={catalog} serverToday={minskDate()} gallery={<ProductGallery photos={productPhotos(slug)} name={name} />} />;
}
