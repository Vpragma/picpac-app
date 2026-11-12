// Админка → очередь модерации (модератор и админ): фото с флагом, вывод модели словами, «Одобрить» и «Вернуть на замену»,
// история решений и счётчики (N4, N9).
import ModerationQueue from "@/components/admin/ModerationQueue";
import { requirePageRole } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  await requirePageRole(["moderator", "admin"], "/admin/moderation");
  return (
    <div>
      <h1>Модерация фото</h1>
      <p className="muted small">
        Фото, которые проверка (на телефоне клиента и повторно на нашем сервере) пометила как подозрительные. Модель пишет, что нашла, словами; фото размыто, пока вы не нажмёте «Показать». Автоматика никогда не отклоняет — решает человек. Данные клиента скрыты.
      </p>
      <ModerationQueue />
    </div>
  );
}
