// Помощь (N-10): телефон и почта поддержки ссылками, часы работы, короткие ответы.
// Сроки и цены доставки — из того же каталога, что в корзине (без дублирования в коде).
import Link from "next/link";
import { loadCatalog } from "@/lib/server/catalog";
import { formatByn } from "@/lib/pricing";
import { SUPPORT } from "@/lib/support";

export const metadata = {
  title: "Помощь — PicPac",
  description: "Поддержка PicPac: телефон, почта, доставка, оплата, перепечатка и как собрать фотокнигу.",
};

async function safeCatalog() {
  try {
    return await loadCatalog();
  } catch (e) {
    console.error(e?.message);
    return null;
  }
}

function deliveryPrice(d) {
  if (!d.priceKop) return "бесплатно";
  return formatByn(d.priceKop) + (d.freeFromKop ? `, бесплатно от ${formatByn(d.freeFromKop)}` : "");
}

export default async function HelpPage() {
  const catalog = await safeCatalog();
  const delivery = catalog?.delivery || [];
  const bookDays = catalog?.products.find((p) => p.kind === "book")?.printDays || 3;
  const photoDays = catalog?.products.find((p) => p.kind !== "book")?.printDays || 2;
  return (
    <div className="narrow">
      <h1>Помощь</h1>
      <p className="muted">Ответим на вопросы о фотокнигах, заказе и доставке.</p>

      <section className="card help-contacts" aria-labelledby="help-call">
        <h2 id="help-call">Позвоните или напишите — поможем</h2>
        <p style={{ margin: 0 }}>Ежедневно {SUPPORT.hours}</p>
        <a className="btn btn-primary btn-block" href={SUPPORT.phoneHref}>
          Позвонить: {SUPPORT.phone}
        </a>
        <a className="btn btn-block" href={SUPPORT.emailHref}>
          Написать на почту: {SUPPORT.email}
        </a>
        <Link className="btn btn-block" href="/orders">
          Написать в чат по заказу
        </Link>
        <p className="muted small" style={{ margin: "8px 0 0" }}>
          Чат — на странице заказа: «Мои заказы» → заказ → «Написать в поддержку». Без входа в аккаунт звоните или пишите на почту.
        </p>
      </section>

      <section className="card faq" aria-labelledby="help-faq">
        <h2 id="help-faq">Короткие ответы</h2>
        <details>
          <summary>Как собрать фотокнигу</summary>
          <div>
            <ol>
              <li>В каталоге выберите книгу и нажмите «Создать фотокнигу».</li>
              <li>Добавьте фото с телефона или компьютера (можно сразу несколько) — или возьмите «Тестовую галерею».</li>
              <li>«Автомакет» сам разложит фото по разворотам. На шаге «Правки» поменяйте порядок, кадр и цвет.</li>
              <li>На шаге «Проверка» посмотрите подсказки: тёмные или мелкие фото мы отметим.</li>
              <li>Нажмите «В корзину» и оформите заказ.</li>
            </ol>
            <p className="muted small" style={{ margin: "8px 0 0" }}>Черновик сохраняется сам — вернуться можно в «Мои книги».</p>
          </div>
        </details>
        <details>
          <summary>Доставка и сроки</summary>
          <div>
            <p>
              Печатаем фотокниги за {bookDays} дн., фото — за {photoDays} дн. Точную дату доставки корзина покажет до оплаты.
            </p>
            {delivery.length > 0 ? (
              <table className="help-table">
                <thead>
                  <tr>
                    <th scope="col">Способ</th>
                    <th scope="col">Срок</th>
                    <th scope="col">Цена</th>
                  </tr>
                </thead>
                <tbody>
                  {delivery.map((d) => (
                    <tr key={d.code}>
                      <th scope="row">{d.name}</th>
                      <td>{d.eta || `${d.minDays}–${d.maxDays} дн.`}</td>
                      <td>{deliveryPrice(d)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Белпочта, Европочта и курьер — от 5,90 BYN; Белпочтой бесплатно от 150,00 BYN.</p>
            )}
          </div>
        </details>
        <details>
          <summary>Оплата</summary>
          <div>
            <p>На сайте PicPac — картой VISA, Mastercard, БЕЛКАРТ или через ЕРИП.</p>
            <p style={{ margin: 0 }}>
              <b>В этом приложении оплата тестовая:</b> деньги не списываются, данные карты не нужны.
            </p>
          </div>
        </details>
        <details>
          <summary>Перепечатка, если брак</summary>
          <div>
            <p>Брак печати — перепечатаем бесплатно.</p>
            <p style={{ margin: 0 }}>
              Откройте заказ → «Написать в поддержку» → тема «Брак печати — нужна перепечатка». Сфотографируйте брак и опишите, что не так.
            </p>
          </div>
        </details>
        <details>
          <summary>Как включить крупный текст</summary>
          <div>
            <p style={{ margin: 0 }}>
              Откройте <Link href="/profile">Профиль</Link> → «Крупный текст». Всё станет крупнее на четверть; настройка сохранится на этом устройстве.
            </p>
          </div>
        </details>
      </section>

      <Link href="/" className="btn btn-block">
        В каталог
      </Link>
    </div>
  );
}
