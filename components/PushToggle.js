"use client";
// Профиль → «Уведомления на этом устройстве» (D5): пуш о важном по заказам и напоминание о корзине.
// Только по согласию и нажатию; отключить — одной кнопкой. Если пуши недоступны — честно объясняем почему:
// новости всё равно видны в разделе «Уведомления».
import { useEffect, useState } from "react";
import { callApi } from "@/lib/api";
import { currentSubscription, disablePush, enablePush, pushSupport } from "@/lib/push";

const REASONS = {
  denied: "Уведомления выключены в настройках браузера. Новости заказа всё равно видны в разделе «Уведомления».",
  default: "Разрешение не дано. Можно включить позже — здесь же.",
  no_sw: "Приложение ещё загружается. Обновите страницу и попробуйте снова.",
  subscribe: "Браузер не смог подписаться на уведомления. Проверьте интернет и попробуйте ещё раз.",
};

export default function PushToggle() {
  const [support, setSupport] = useState(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    let alive = true;
    const s = pushSupport();
    (async () => {
      const sub = s === "ok" ? await currentSubscription() : null;
      if (!alive) return;
      setSupport(s);
      setOn(!!sub);
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    if (busy) return;
    setBusy(true);
    setMsg("");
    const r = await enablePush();
    setBusy(false);
    if (r.ok) {
      setOn(true);
      setMsg("Готово: сообщим, когда заказ будет готов, и напомним о книге в корзине (не ночью).");
    } else {
      if (r.reason === "denied") setSupport("denied");
      setMsg(r.message || REASONS[r.reason] || "Не получилось включить. Попробуйте ещё раз.");
    }
  }

  // D9: «Проверить уведомления» — тестовый пуш себе (сервер пускает раз в минуту)
  async function check() {
    if (busy) return;
    setBusy(true);
    setMsg("Отправляем тестовое уведомление…");
    const r = await callApi("/api/v1/push/test", { body: {} });
    setBusy(false);
    setMsg(r.ok ? r.text + " Уведомление «PicPac: уведомления работают» придёт через несколько секунд." : r.text || r.error?.message || "Не получилось. Попробуйте ещё раз.");
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    await disablePush();
    setBusy(false);
    setOn(false);
    setMsg("Уведомления на этом устройстве выключены.");
  }

  if (!support) return null;
  return (
    <section className="card" aria-labelledby="push-h">
      <h2 id="push-h" style={{ fontSize: 18 }}>
        Уведомления на этом устройстве
      </h2>
      {support === "ok" && (
        <>
          <p className="muted small">Только важное: заказ готов или передан в доставку, ответ поддержки, книга ждёт в корзине. Ночью (22:00–09:00) напоминаний нет.</p>
          {on ? (
            <>
              <p className="small" data-testid="push-state" style={{ fontWeight: 600 }}>
                Включены на этом устройстве
              </p>
              <button type="button" className="btn btn-primary btn-block" onClick={check} disabled={busy}>
                Проверить уведомления
              </button>
              <button type="button" className="btn btn-block" onClick={disable} disabled={busy} style={{ marginTop: 8 }}>
                {busy ? "Подождите…" : "Отключить уведомления"}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-block" onClick={enable} disabled={busy}>
              {busy ? "Включаем…" : "Сообщать о заказах и важном"}
            </button>
          )}
        </>
      )}
      {support === "ios-install" && (
        <>
          <p className="small" data-testid="push-state" style={{ fontWeight: 600 }}>
            Сначала установите приложение (iPhone)
          </p>
          <p className="muted small">
            Уведомления на iPhone работают в приложении с экрана «Домой» (iOS 16.4+): в Safari нажмите «Поделиться» <span aria-hidden="true">(квадрат со стрелкой ↑)</span> → «На экран „Домой“» → «Добавить», откройте PicPac со значка и включите здесь. <a href="/help#install">Подробнее</a>
          </p>
        </>
      )}
      {support === "denied" && (
        <>
          <p className="small" data-testid="push-state" style={{ fontWeight: 600 }}>
            Запрещены в настройках телефона
          </p>
          <p className="muted small">
            Как включить: настройки телефона → PicPac (или браузер) → «Уведомления» → разрешить, затем вернитесь сюда. Новости заказа всё равно видны в разделе «Уведомления». <a href="/help#install">Подробнее</a>
          </p>
        </>
      )}
      {support === "unsupported" && <p className="muted small">Этот браузер не умеет уведомления — новости видны в разделе «Уведомления».</p>}
      {msg && (
        <p className="small" role="status" style={{ marginBottom: 0 }}>
          {msg}
        </p>
      )}
    </section>
  );
}
