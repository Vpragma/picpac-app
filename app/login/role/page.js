// Выбор роли. Показывается только после входа и только если у аккаунта несколько ролей.
import { redirect } from "next/navigation";
import RoleChooser from "@/components/auth/RoleChooser";
import { staffMfaRequired } from "@/lib/server/env";
import { fitNext, getAuth } from "@/lib/server/session";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Выбор роли — PicPac" };

export default async function RolePage({ searchParams }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "", "");
  const auth = await getAuth();
  if (!auth.user) redirect("/login" + (next ? `?next=${encodeURIComponent(next)}` : ""));
  // Одна роль — выбирать нечего
  if (auth.roles.length <= 1) redirect(auth.roles[0] ? fitNext(next, auth.roles[0]) : "/");

  const { data: profile } = await auth.supabase.from("profiles").select("full_name").eq("id", auth.user.id).maybeSingle();
  return (
    <RoleChooser
      roles={auth.roles}
      activeRole={auth.activeRole}
      next={next}
      name={profile?.full_name || ""}
      email={auth.user.email}
      mfaRequired={staffMfaRequired()}
    />
  );
}
