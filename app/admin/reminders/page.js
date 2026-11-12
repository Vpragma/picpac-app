// Админка → «Напоминания» (D5, W-10): только для роли admin.
import CartRemindersCard from "@/components/admin/CartRemindersCard";
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const metadata = { title: "Напоминания — PicPac" };

export default async function RemindersPage() {
  await requirePageRole(["admin"], "/admin/reminders");
  const { data } = await createSupabaseAdmin().rpc("app_setting", { _key: "cart_reminder_after_minutes" });
  const after = [5, 60, 1440].includes(Number(data)) ? Number(data) : 1440;
  return (
    <div>
      <h1>Напоминания</h1>
      <CartRemindersCard initialAfter={after} />
    </div>
  );
}
