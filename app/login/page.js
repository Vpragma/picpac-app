// Вход и регистрация. Проверка пароля и сессия — только на сервере (/api/v1/auth/*).
import Link from "next/link";
import { redirect } from "next/navigation";
import AuthForms from "@/components/auth/AuthForms";
import LogoutButton from "@/components/auth/LogoutButton";
import { ROLE_LABELS } from "@/lib/roles";
import { getAuth } from "@/lib/server/session";
import { safeNext } from "@/lib/validate";

export const metadata = { title: "Вход — PicPac" };

export default async function LoginPage({ searchParams }) {
  const sp = await searchParams;
  const next = safeNext(typeof sp.next === "string" ? sp.next : "", "");
  const reason = sp.reason === "checkout" ? "checkout" : "";
  const mode = sp.mode === "register" ? "register" : "login";

  const auth = await getAuth();
  if (auth.user) {
    if (next) redirect(next);
    return (
      <div className="card stack">
        <h1>Вы уже вошли</h1>
        <p className="muted">
          {auth.user.email}
          {auth.activeRole ? ` · ${ROLE_LABELS[auth.activeRole]}` : ""}
        </p>
        <Link href="/profile" className="btn btn-primary btn-block">
          В профиль
        </Link>
        {auth.roles.length > 1 && (
          <Link href="/login/role" className="btn btn-block">
            Сменить роль
          </Link>
        )}
        <LogoutButton className="btn btn-block" />
      </div>
    );
  }

  return <AuthForms next={next} reason={reason} initialMode={mode} />;
}
