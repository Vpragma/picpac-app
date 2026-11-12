// Профиль: имя, почта, роли, выход и удаление аккаунта. Данные читает сервер от имени пользователя.
import Link from "next/link";
import AccountPanel from "@/components/auth/AccountPanel";
import Notifications from "@/components/Notifications";
import PushToggle from "@/components/PushToggle";
import AutoEnhanceSetting from "@/components/AutoEnhanceSetting";
import TextSizeSetting from "@/components/TextSizeSetting";
import ThemeSetting from "@/components/ThemeSetting";
import { THEME_COOKIE, parseTheme } from "@/lib/themeShared";
import { cookies } from "next/headers";
import { SUPPORT } from "@/lib/support";
import { InstallCard } from "@/components/Pwa";
import { isStaffRole } from "@/lib/roles";
import { staffMfaRequired } from "@/lib/server/env";
import { getAuth } from "@/lib/server/session";

export const metadata = { title: "Профиль — PicPac" };

export default async function ProfilePage() {
  const auth = await getAuth();
  const jar = await cookies();
  const largeText = jar.get("pp_text")?.value === "lg";
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  let profile = null;
  let mfa = null;
  if (auth.user) {
    const { data } = await auth.supabase.from("profiles").select("full_name, created_at").eq("id", auth.user.id).maybeSingle();
    profile = data;
    // Сотрудникам показываем, подключён ли двухфакторный вход
    // Блок 2FA — только в роли сотрудника: клиенту он не нужен
    const staffRole = isStaffRole(auth.activeRole) ? auth.activeRole : null;
    if (staffRole) {
      const { data: factors } = await auth.supabase.auth.mfa.listFactors();
      mfa = { required: staffMfaRequired(), enrolled: !!factors?.totp?.length, aal: auth.aal, role: staffRole };
    }
  }

  return (
    <div className="narrow">
      <h1>Профиль</h1>
      {auth.user ? (
        <AccountPanel
          name={profile?.full_name || ""}
          email={auth.user.email}
          roles={auth.roles}
          activeRole={auth.activeRole}
          isDemo={auth.user.isDemo}
          mfa={mfa}
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
          <Link href="/" className="btn btn-block">
            Назад к каталогу
          </Link>
          <p className="muted small" style={{ margin: 0 }}>
            После входа проекты, корзина и заказы хранятся в аккаунте и видны на любом устройстве.
          </p>
        </div>
      )}
      {auth.user && <Notifications />}
      <ThemeSetting initial={theme} />
      <TextSizeSetting initial={largeText} />
      {auth.user && <PushToggle />}
      <AutoEnhanceSetting account={!!auth.user && auth.activeRole === "client"} />
      <InstallCard />
      <section className="card">
        <h3>Поддержка</h3>
        <p style={{ margin: 0 }}>
          <a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a> · <a href={SUPPORT.emailHref}>{SUPPORT.email}</a>
        </p>
        <p className="muted small">Ежедневно {SUPPORT.hours}</p>
        <Link href="/help" className="btn btn-small">
          Все ответы — в «Помощи»
        </Link>
      </section>
    </div>
  );
}
