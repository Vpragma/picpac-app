// «Мои заказы» (пункт 12): гостю экран «Войдите» приходит сразу с сервера, без «Загружаем заказы…».
// Признак — наличие cookie сессии Supabase (проверка без запроса в сеть). Если сессия есть, список грузит клиент
// (components/OrdersList.js); истёкшую сессию он сам покажет как «Войдите».
import Link from "next/link";
import { cookies } from "next/headers";
import OrdersList from "@/components/OrdersList";

export default async function OrdersPage() {
  const jar = await cookies();
  const maybeSignedIn = jar.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  if (maybeSignedIn) return <OrdersList />;
  return (
    <div>
      <h1>Мои заказы</h1>
      <div className="card stack">
        <p>Заказы хранятся в аккаунте. Войдите, чтобы увидеть историю и статусы.</p>
        <Link href="/login?next=/orders" className="btn btn-primary btn-block">
          Войти
        </Link>
        <Link href="/" className="btn btn-block">
          В каталог
        </Link>
      </div>
    </div>
  );
}
