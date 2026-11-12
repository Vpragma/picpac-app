// «Мои заказы» (ТЗ п. 8). Кто вошёл, сервер знает сразу: гостю — сразу экран «Войдите»
// (раньше он несколько секунд ждал ответа /api/v1/me с надписью «Загружаем заказы…»).
// Вошедшему — список из GET /api/v1/orders (components/OrdersList.js, обновляется раз в 15 секунд).
import Link from "next/link";
import OrdersList from "@/components/OrdersList";
import { getAuth } from "@/lib/server/session";

export default async function OrdersPage() {
  let guest = false;
  try {
    guest = !(await getAuth()).user;
  } catch {
    guest = false; // сервер не проверил вход — пусть решит экран списка (он умеет «Повторить»)
  }
  if (!guest) return <OrdersList />;
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
