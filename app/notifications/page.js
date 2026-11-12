// Центр уведомлений клиента (П7: имитация пушей — список на сервере). Данные загружает компонент с устройства.
import NotificationCenter from "@/components/NotificationCenter";

export const metadata = { title: "Уведомления — PicPac" };

export default function NotificationsPage() {
  return (
    <div>
      <h1>Уведомления</h1>
      <p className="muted small">Только важное: заказ принят, передан в доставку, завершён, ответ поддержки, нужно заменить фото.</p>
      <NotificationCenter />
    </div>
  );
}
