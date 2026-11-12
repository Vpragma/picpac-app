// Админка → обращение клиента (оператор = админ). Переписка и ответ — в компоненте (опрос 15 с).
import Link from "next/link";
import SupportChat from "@/components/admin/SupportChat";
import { requirePageRole } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export default async function AdminSupportPage({ params }) {
  const { id } = await params;
  await requirePageRole(["admin"], `/admin/support/${id}`);
  return (
    <div>
      <Link href="/admin" className="back-link">
        ← Обзор
      </Link>
      <SupportChat id={id} />
    </div>
  );
}
