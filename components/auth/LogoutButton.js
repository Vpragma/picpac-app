"use client";
// Кнопка «Выйти» (M-01): сначала отправляем в аккаунт всё, что ещё не ушло, затем стираем данные
// с устройства (черновики, фото, корзину, кэш, ключи picpac:*) и закрываем сессию на сервере.
// Если отправить не удалось — предупреждаем и даём выбор: повторить или выйти без этих изменений.
import { useState } from "react";
import { logoutAndWipe, syncBeforeLogout } from "../../lib/device";
import { notify } from "../../lib/store";

export default function LogoutButton({ className = "btn" }) {
  const [busy, setBusy] = useState("");
  const [unsynced, setUnsynced] = useState(false);

  async function finish() {
    setBusy("Выходим…");
    const res = await logoutAndWipe();
    if (!res.ok) {
      setBusy("");
      notify(res.message, "error");
    }
  }

  async function logout() {
    setBusy("Сохраняем в аккаунт…");
    const ok = await syncBeforeLogout();
    if (!ok) {
      setBusy("");
      setUnsynced(true);
      return;
    }
    await finish();
  }

  if (unsynced)
    return (
      <div className="card stack" role="alert" style={{ borderColor: "var(--ds-color-error)" }}>
        <b>Не все изменения сохранились в аккаунте</b>
        <p className="small" style={{ margin: 0 }}>
          Нет связи с сервером или он не ответил. При выходе мы стираем данные с этого устройства — несохранённые фото и правки пропадут. Проверьте интернет и нажмите «Повторить».
        </p>
        <div className="row wrap">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={!!busy}
            onClick={() => {
              setUnsynced(false);
              logout();
            }}
          >
            Повторить
          </button>
          <button type="button" className="btn btn-small" disabled={!!busy} onClick={finish}>
            Выйти без них
          </button>
        </div>
      </div>
    );

  return (
    <button type="button" className={className} onClick={logout} disabled={!!busy} aria-busy={!!busy}>
      {busy || "Выйти"}
    </button>
  );
}
