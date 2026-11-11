// Профиль: имя, почта, роли, выход и удаление аккаунта. Данные читает сервер от имени пользователя.
import Link from "next/link";
import AccountPanel from "@/components/auth/AccountPanel";
import Notifications from "@/components/Notifications";
import { getAuth } from "@/lib/server/session";

export const metadata = { title: "Профиль — PicPac" };

export default async function ProfilePage() {
  const auth = await getAuth();
  let profile = null;
  if (auth.user) {
    const { data } = await auth.supabase.from("profiles").select("full_name, created_at").eq("id", auth.user.id).maybeSingle();
    profile = data;
  }

  return (
    <div>
      <h1>Профиль</h1>
      {auth.user ? (
        <AccountPanel
          name={profile?.full_name || ""}
          email={auth.user.email}
          roles={auth.roles}
          activeRole={auth.activeRole}
          isDemo={auth.user.isDemo}
        />
      ) : (
        <div className="card stack">
          <p>Вы в гостевом режиме. Каталог, редактор и корзина работают без входа — черновики хранятся на этом устройстве.</p>
          <Link href="/login" className="btn btn-primary btn-block">
            Войти
          </Link>
          <Link href="/login?mode=register" className="btn btn-block">
            Зарегистрироваться
          </Link>
        </div>
      )}
      <Notifications />
      <section className="card">
        <h3>Поддержка</h3>
        <p className="small">support@picpac.by · +375 44 539-67-89, ежедневно 9:00–21:00</p>
      </section>
    </div>
  );
}
