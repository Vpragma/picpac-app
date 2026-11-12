// Главная — каталог. Отрисовывается на сервере из базы (тот же источник, что GET /api/v1/catalog),
// обновляется не реже раза в минуту. Браузер каталог повторно не запрашивает.
import { loadCatalog } from "@/lib/server/catalog";
import CatalogView from "@/components/CatalogView";

export const revalidate = 60;

export default async function CatalogPage() {
  let catalog = null;
  try {
    catalog = await loadCatalog();
  } catch (e) {
    // База недоступна — экран сам запросит каталог через API и покажет «Повторить»
    console.error(e?.message);
  }
  return <CatalogView initial={catalog} />;
}
