// Админка → уведомления сотрудника: админу — все заказы и обращения, модератору — только модерация.
import StaffFeed from "@/components/admin/StaffFeed";
import { requirePageRole } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AdminNotificationsPage() {
  await requirePageRole(["moderator", "admin"], "/admin/notifications");
  return (
    <div>
      <h1>Уведомления</h1>
      <StaffFeed />
    </div>
  );
}
