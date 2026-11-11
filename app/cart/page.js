"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useStored, readKey, writeKey, notify } from "../../lib/store";
import { DELIVERY, calcTotals, findPromo } from "../../lib/delivery";
import { deliveryRange, money } from "../../lib/price";
import { createOrder } from "../../lib/orders";
import { IconImage, IconTrash } from "../../components/icons";

export default function CartPage() {
  const router = useRouter();
  const [cart, setCart, ready] = useStored("cart", []);
  const [deliveryId, setDeliveryId] = useState("belpost");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState(null);
  const [promoError, setPromoError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  // Ключ оформления: один и тот же для повторных нажатий — второй заказ не создаётся.
  useEffect(() => {
    if (!readKey("checkoutKey", null)) writeKey("checkoutKey", "k" + Date.now() + Math.random().toString(36).slice(2));
  }, []);

  if (!ready) return <p className="muted">Загружаем корзину…</p>;
  if (!cart.length)
    return (
      <div className="card">
        <h2>Корзина пуста</h2>
        <p className="muted">Соберите фотокнигу или закажите печать фото — это займёт пару минут.</p>
        <Link href="/" className="btn btn-primary">
          В каталог
        </Link>
      </div>
    );

  const t = calcTotals(cart, deliveryId, promo);
  const printDays = Math.max(...cart.map((i) => i.printDays || 3));

  function applyPromo() {
    const p = findPromo(promoInput);
    if (p) {
      setPromo(p);
      setPromoError("");
    } else {
      setPromo(null);
      setPromoError("Такого промокода нет. Проверьте, нет ли опечатки.");
    }
  }

  function confirm() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
    const checkoutKey = readKey("checkoutKey", "k" + Date.now());
    const d = DELIVERY.find((x) => x.id === deliveryId);
    const { order } = createOrder({
      checkoutKey,
      items: cart,
      delivery: { id: d.id, name: d.name, note: d.note, eta: d.eta },
      promo: promo?.code || null,
      totals: t,
    });
    writeKey("cart", []);
    writeKey("checkoutKey", null);
    router.push("/orders/" + order.id + "?new=1");
    } catch (e) {
      console.error(e);
      notify("Не получилось оформить заказ. Попробуйте ещё раз.", "error");
      lock.current = false; // после успеха замок не снимаем: второй заказ не создаётся
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Корзина</h1>
      {cart.map((i) => (
        <div key={i.id} className="card row" style={{ gap: 12 }}>
          {i.cover ? <img src={i.cover} alt="" className="issue-thumb" /> : <div className="issue-thumb row" style={{ justifyContent: "center" }}><IconImage /></div>}
          <div style={{ flex: 1 }}>
            <b style={{ color: "var(--ds-color-text-strong)" }}>{i.name}</b>
            <div className="muted small">
              {i.sizeId.replace("x", "×")} см · {i.pages ? `${i.pages} стр. · ` : ""}
              {i.photoCount} фото
            </div>
            <b>{money(i.price)}</b>
          </div>
          <button className="icon-btn" aria-label="Убрать из корзины" onClick={() => setCart(cart.filter((c) => c.id !== i.id))}>
            <IconTrash size={18} />
          </button>
        </div>
      ))}

      <section className="card">
        <h3>Доставка</h3>
        {DELIVERY.map((d) => {
          const free = d.freeFrom != null && t.goods - t.discount >= d.freeFrom;
          return (
            <label key={d.id} className={"radio-row" + (d.id === deliveryId ? " selected" : "")}>
              <input type="radio" name="delivery" checked={d.id === deliveryId} onChange={() => setDeliveryId(d.id)} />
              <div style={{ flex: 1 }}>
                <b style={{ color: "var(--ds-color-text-strong)" }}>{d.name}</b> <span className="muted small">{d.note}</span>
                <div className="muted small">
                  {d.eta}
                  {d.freeFrom != null && ` · бесплатно от ${money(d.freeFrom)}`}
                </div>
              </div>
              <b className={free ? "ok-text" : ""}>{free ? "бесплатно" : money(d.price)}</b>
            </label>
          );
        })}
        <p className="muted small">
          Напечатаем за {printDays} дня — доставим ориентировочно {deliveryRange(printDays)}.
        </p>
      </section>

      <section className="card">
        {!promoOpen ? (
          <button className="btn btn-small" onClick={() => setPromoOpen(true)}>
            Есть промокод?
          </button>
        ) : (
          <>
            <div className="row">
              <input className="input" placeholder="Промокод, например TEST10" value={promoInput} onChange={(e) => setPromoInput(e.target.value)} aria-label="Промокод" onKeyDown={(e) => e.key === "Enter" && applyPromo()} />
              <button className="btn btn-small" onClick={applyPromo}>
                Применить
              </button>
            </div>
            {promo && <p className="ok-text small" style={{ marginTop: 6 }}>Промокод {promo.code} применён: {promo.label}</p>}
            {promoError && <p className="err-text small" style={{ marginTop: 6 }}>{promoError}</p>}
          </>
        )}
      </section>

      <section className="card">
        <div className="sum-line"><span>Товары</span><span>{money(t.goods)}</span></div>
        {t.discount > 0 && <div className="sum-line ok-text"><span>Скидка {promo.code}</span><span>−{money(t.discount)}</span></div>}
        <div className="sum-line"><span>Доставка</span><span>{t.freeDelivery ? "бесплатно" : money(t.delivery)}</span></div>
        <div className="sum-line sum-total"><span>Итого</span><span>{money(t.total)}</span></div>
        <p className="muted small" style={{ marginTop: 8 }}>Платить сейчас не нужно — это тестовый заказ без оплаты.</p>
        <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy} style={{ marginTop: 8 }}>
          {busy ? "Оформляем…" : "Подтвердить заказ"}
        </button>
      </section>
    </div>
  );
}
