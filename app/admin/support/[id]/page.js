// Админка → обращение клиента (оператор = админ). Переписка и ответ — в компоненте (опрос 15 с).
// N7: несуществующее обращение — сразу страница 404 с понятным текстом (а не «Загружаем обращение…» с кодом 200).
import Link from "next/link";
import { notFound } from "next/navigation";
import SupportChat from "@/components/admin/SupportChat";
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminSupportPage({ params }) {
  const { id } = await params;
  await requirePageRole(["admin"], `/admin/support/${id}`);
  if (!UUID_RE.test(id)) notFound();
  const { data, error } = await createSupabaseAdmin().from("interactions").select("id").eq("id", id).maybeSingle();
  if (!error && !data) notFound();
  return (
    <div>
      <Link href="/admin" className="back-link">
        ← Обзор
      </Link>
      <SupportChat id={id} />
    </div>
  );
}
