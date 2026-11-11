// Код из приложения-аутентификатора для роли модератора или администратора.
// Нет подключённого приложения — показываем QR-код для подключения.
import { redirect } from "next/navigation";
import MfaStep from "@/components/auth/MfaStep";
import { isStaffRole, ROLE_LABELS } from "@/lib/roles";
import { staffMfaRequired } from "@/lib/server/env";
import { fitNext, getAuth } from "@/lib/server/session";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Код подтверждения — PicPac" };

export default async function MfaPage({ searchParams }) {
  const sp = await searchParams;
  const role = typeof sp.role === "string" ? sp.role : "";
  const next = safeNext(typeof sp.next === "string" ? sp.next : "", "");
  const here = `/login/mfa?role=${encodeURIComponent(role)}${next ? `&next=${encodeURIComponent(next)}` : ""}`;

  const auth = await getAuth();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(here)}`);
  if (!isStaffRole(role) || !auth.roles.includes(role)) redirect("/login/role");
  // Код не нужен: флаг выключен или код уже введён в этой сессии
  if (!staffMfaRequired() || auth.aal === "aal2") {
    return <MfaStep mode="skip" role={role} roleLabel={ROLE_LABELS[role]} next={fitNext(next, role)} />;
  }

  const { data: factors } = await auth.supabase.auth.mfa.listFactors();
  const hasFactor = !!factors?.totp?.length;
  return <MfaStep mode={hasFactor ? "code" : "enroll"} role={role} roleLabel={ROLE_LABELS[role]} next={next} email={auth.user.email} />;
}
