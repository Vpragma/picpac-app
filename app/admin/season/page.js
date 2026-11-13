// Админка → «Сезон» (N2): «Без сезона», «Осень», «Чёрная пятница», «Новый год» с превью. Только для роли admin.
// Смена — сразу у всех клиентов (настройка в базе, клиенты перечитывают сезон при открытии и возврате на вкладку), действие — в журнале.
import SeasonPanel from "@/components/admin/SeasonPanel";
import { readSeasonInfo } from "@/lib/server/season";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Сезон — PicPac" };

export default async function SeasonPage() {
  await requirePageRole(["admin"], "/admin/season");
  let info = { season: "none", updatedAt: null, updatedBy: null, error: false };
  try {
    info = { ...(await readSeasonInfo()), error: false };
  } catch (e) {
    console.error("Сезон:", e?.message);
    info.error = true;
  }
  return (
    <div>
      <h1>Сезон оформления</h1>
      <p className="muted" style={{ maxWidth: "48rem" }}>
        У Pic Pac шесть сезонных айдентик в год — маркетинг меняет сезон сам, без программиста. Меняются только сезонные элементы: промо-плашка и баннер на
        главной, линейная графика и цвет логотипа. Кнопки, текст и фон приложения остаются фирменными.
      </p>
      <SeasonPanel initial={info} />
    </div>
  );
}
