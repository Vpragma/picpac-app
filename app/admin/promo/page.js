// Админка → «Промокоды» (N8): список со статистикой, создать, изменить, выключить. Только роль admin
// (proxy.js — первая линия, здесь — вторая, API проверяет роль ещё раз).
import PromoAdmin from "@/components/admin/PromoAdmin";
import { requirePageRole } from "@/lib/server/session";

export const metadata = { title: "Промокоды — PicPac" };

export default async function PromoPage() {
  await requirePageRole(["admin"], "/admin/promo");
  return (
    <div>
      <h1>Промокоды</h1>
      <PromoAdmin />
    </div>
  );
}
