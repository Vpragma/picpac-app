// Админка → «Демо пушей» (D9): живой пуш на телефон ведущего на защите. Только для роли admin.
import PushDemoPanel from "@/components/admin/PushDemoPanel";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Демо пушей — PicPac" };

export default async function PushDemoPage() {
  await requirePageRole(["admin"], "/admin/push");
  return (
    <div>
      <h1>Демо пушей</h1>
      <p className="muted">Пуш уходит на все устройства выбранного тестового клиента, где включены уведомления. Тексты — только готовые шаблоны, не чаще раза в 10 секунд.</p>
      <PushDemoPanel />
    </div>
  );
}
