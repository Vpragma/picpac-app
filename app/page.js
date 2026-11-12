// Главная (N1): эмоциональный первый экран про воспоминания, «как это работает», каталог с плашками,
// ИИ-редактор, доверие. Каталог отрисовывается на сервере из базы (тот же источник, что GET /api/v1/catalog),
// обновляется не реже раза в минуту. Браузер каталог повторно не запрашивает.
import { loadCatalog } from "@/lib/server/catalog";
import CatalogView from "@/components/CatalogView";
import ProductPhoto from "@/components/ProductPhoto";
import Onboarding from "@/components/Onboarding";
import SeasonPromo from "@/components/promo/SeasonPromo";
import { AiBlock, HomeHero, HowItWorks, Trust } from "@/components/home/HomeSections";
import { PRODUCT_PHOTOS } from "@/lib/productPhotos";

// Обложки карточек — фото продуктов, собранные на сервере (getImageProps + <picture>): JS главной не растёт.
// Все лениво: приоритет на главной — у первого фото коллажа (LCP).
const COVER_SIZES = "(min-width: 1440px) 22rem, (min-width: 1024px) 30vw, (min-width: 768px) 45vw, 100vw";

export const revalidate = 60;

export default async function HomePage() {
  let catalog = null;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    // База недоступна — экран сам запросит каталог через API и покажет «Повторить»
    console.error(e?.message);
  }
  const covers = Object.fromEntries(
    Object.entries(PRODUCT_PHOTOS).map(([slug, photos]) => [slug, <ProductPhoto key={slug} photo={photos[0]} alt="" sizes={COVER_SIZES} />]),
  );
  return (
    <>
      <HomeHero />
      <SeasonPromo place="home" />
      <HowItWorks />
      <CatalogView initial={catalog} covers={covers} />
      <AiBlock />
      <Trust />
      <Onboarding />
    </>
  );
}
