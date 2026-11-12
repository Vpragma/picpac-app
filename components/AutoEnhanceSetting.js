"use client";
// Профиль: выключатель «Улучшать автоматически» (тот же, что в редакторе фото)
import { setAutoEnhance, useAutoEnhance } from "../lib/photo/settings";
import AiPrefetch from "./editor/AiPrefetch";

// account — вошедший клиент: его фото хранятся в аккаунте (N7: честный текст о том, где лежат фото)
export default function AutoEnhanceSetting({ account = false }) {
  const on = useAutoEnhance();
  return (
    <section className="card">
      <h3>Редактор фото</h3>
      <p className="muted small" data-photo-storage={account ? "account" : "device"}>
        ИИ-правки считаются только на вашем телефоне — фото и команды для правок никуда не отправляются.{" "}
        {account
          ? "Сами фото хранятся в вашем аккаунте PicPac, в нашем защищённом хранилище: так проект есть на всех ваших устройствах и его можно напечатать."
          : "Пока вы не вошли, фото остаются на этом устройстве — к нам они попадут только с заказом, для печати."}
      </p>
      <label className="row between pe-switch">
        <span>
          <b>Улучшать автоматически</b>
          <span className="muted small" style={{ display: "block" }}>
            Тёмные, пересвеченные и «цветные» фото мягко поправим при добавлении. Оригинал не меняется — улучшение можно отменить в редакторе.
          </span>
        </span>
        <input type="checkbox" role="switch" checked={on} onChange={(e) => setAutoEnhance(e.target.checked)} aria-label="Улучшать автоматически" />
      </label>
      {/* ED (п. 4): модели ИИ заранее, пока есть хорошая сеть */}
      <AiPrefetch />
    </section>
  );
}
