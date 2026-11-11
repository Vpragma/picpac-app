"use client";
import { retryDraft } from "../lib/draft";

// Показываем, если база черновиков на устройстве не открылась
export default function DraftError() {
  return (
    <div className="card" role="alert">
      <h2>Не получилось открыть черновик</h2>
      <p className="muted">
        Браузер не дал доступ к хранилищу на устройстве. Так бывает в режиме «инкогнито» или если приложение открыто в нескольких вкладках. Закройте лишние вкладки и попробуйте ещё раз.
      </p>
      <button className="btn btn-primary" onClick={() => retryDraft()}>
        Повторить
      </button>
    </div>
  );
}
