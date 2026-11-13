// Главная (N1): эмоциональный первый экран про воспоминания, «как это работает», каталог с плашками,
// ИИ-редактор, доверие. Каталог отрисовывается на сервере из базы (тот же источник, что GET /api/v1/catalog),
// обновляется не реже раза в минуту. Браузер каталог повторно не запрашивает.
import { loadCatalog } from "@/lib/server/catalog";
import CatalogView from "@/components/CatalogView";
import ProductPhoto from "@/components/ProductPhoto";
import OnboardingLazy from "@/components/OnboardingLazy";
import { AiBlock, HomeHero, HowItWorks, Trust } from "@/components/home/HomeSections";
import { PRODUCT_PHOTOS } from "@/lib/productPhotos";
import { seasonForRequest } from "@/lib/server/season";
import { seasonalPromoCached } from "@/lib/server/promo";
import SeasonBanner from "@/components/season/SeasonBanner";
import SeasonPromo from "@/components/season/SeasonPromo";
import { seasonPhotos } from "@/components/season/seasonPhotos";

// Обложки карточек — фото продуктов, собранные на сервере (getImageProps + <picture>): JS главной не растёт.
// Приоритет на главной — у первого фото коллажа; обложки — ниже первого экрана, лениво.
const COVER_SIZES = "(min-width: 1440px) 22rem, (min-width: 1024px) 30vw, (min-width: 768px) 45vw, 100vw";

export const revalidate = 60;

export default async function HomePage() {
  // N7: независимые чтения — параллельно, а не по очереди: каталог (копия в памяти на 60 с), сезон (кэш Next)
  // и сезонный промокод (N8, кэш 30 с — seasonalPromoCached; ему нужен только сезон).
  const seasonP = seasonForRequest();
  const [catalog, season, seasonal] = await Promise.all([
    loadCatalog().catch((e) => {
      // База недоступна — экран сам запросит каталог через API и покажет «Повторить»
      console.error(e?.message);
      return null;
    }),
    // Сезон (N2): промо-плашка над первым экраном, баннер — после него (LCP первого экрана не меняется)
    seasonP,
    // Сезонный промокод — в плашке сезона N2: читаем на сервере, чтобы плашка не меняла высоту после загрузки
    seasonP.then((s) => (s !== "none" ? seasonalPromoCached(s) : null)).catch(() => null),
  ]);
  // Обложки — ниже первого экрана, поэтому все лениво (N5: приоритет — только первому экрану)
  const covers = Object.fromEntries(
    Object.entries(PRODUCT_PHOTOS).map(([slug, photos]) => [slug, <ProductPhoto key={slug} photo={photos[0]} alt="" sizes={COVER_SIZES} />]),
  );
  return (
    <>
      <SeasonPromo initial={season} code={seasonal?.code || null} />
      <HomeHero />
      <SeasonBanner initial={season} photos={seasonPhotos()} />
      <HowItWorks />
      <CatalogView initial={catalog} covers={covers} />
      <AiBlock />
      <Trust />
      <OnboardingLazy />
    </>
  );
}
