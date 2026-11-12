// Админка → очередь модерации (модератор и админ): фото с флагом цензуры, «Одобрить» и «Вернуть на замену».
import ModerationQueue from "@/components/admin/ModerationQueue";
import { requirePageRole } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  await requirePageRole(["moderator", "admin"], "/admin/moderation");
  return (
    <div>
      <h1>Модерация фото</h1>
      <p className="muted small">Фото, которые классификатор на устройстве клиента пометил как подозрительные. Автоматика никогда не отклоняет — решает человек. Данные клиента скрыты.</p>
      <ModerationQueue />
    </div>
  );
}
