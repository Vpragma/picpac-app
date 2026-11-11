"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useStored, readKey, writeKey, notify } from "../../../lib/store";
import { deliveryRange, money } from "../../../lib/price";
import { DEMO_STEP_MS, statusLabel } from "../../../lib/orders";
import { StatusChip, Timeline } from "../../../components/OrderBits";
import { IconChat } from "../../../components/icons";

export default function OrderPage() {
  const { id } = useParams();
  const [orders, , ready] = useStored("orders", []);
  const [isNew, setIsNew] = useState(false);
  useEffect(() => setIsNew(window.location.search.includes("new=1")), []);
  if (!ready) return <p className="muted">Загружаем заказ…</p>;
  const o = orders.find((x) => x.id === id);
  if (!o)
    return (
      <div className="card">
        <h2>Заказ не найден</h2>
        <p className="muted">Возможно, он оформлен на другом устройстве.</p>
        <Link href="/orders">Мои заказы</Link>
      </div>
    );
  const printDays = Math.max(...o.items.map((i) => i.printDays || 3));
  return (
    <div>
      <Link href="/orders" className="muted small" style={{ textDecoration: "none" }}>
        ← Мои заказы
      </Link>
      {isNew && (
        <div className="card" style={{ background: "var(--ds-gradient-selected)", marginTop: 8 }}>
          <h2>Спасибо! Заказ принят</h2>
          <p>
            Номер заказа: <b>{o.id}</b>. Мы пришлём уведомление, когда статус изменится.
          </p>
        </div>
      )}
      <div className="row between" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>№ {o.id}</h1>
        <StatusChip status={o.status} />
      </div>
      <p className="muted small">
        Доставим ориентировочно {deliveryRange(printDays, new Date(o.createdAt))} · {o.delivery.name}, {o.delivery.note}
      </p>

      <section className="card">
        <h3>Статус</h3>
        <Timeline order={o} />
        {o.demo && o.status !== "done" && <p className="muted small">Демо-режим: статус сам переходит дальше примерно каждые {DEMO_STEP_MS / 1000} секунд.</p>}
      </section>

      <section className="card">
        <h3>Состав</h3>
        {o.items.map((i) => (
          <div key={i.id} className="sum-line">
            <span>
              {i.name}, {i.sizeId.replace("x", "×")} {i.pages ? `· ${i.pages} стр.` : `· ${i.photoCount} фото`}
            </span>
            <span>{money(i.price)}</span>
          </div>
        ))}
        {o.totals.discount > 0 && (
          <div className="sum-line ok-text">
            <span>Скидка {o.promo}</span>
            <span>−{money(o.totals.discount)}</span>
          </div>
        )}
        <div className="sum-line">
          <span>Доставка</span>
          <span>{o.totals.freeDelivery ? "бесплатно" : money(o.totals.delivery)}</span>
        </div>
        <div className="sum-line sum-total">
          <span>Итого</span>
          <span>{money(o.totals.total)}</span>
        </div>
        <p className="muted small">Тестовый заказ, оплата не списывалась.</p>
      </section>

      <ChatBot order={o} printDays={printDays} />
    </div>
  );
}

const STATUS_TEXT = {
  accepted: "мы получили заказ и скоро проверим макет",
  moderation: "специалист проверяет макет перед печатью",
  production: "книга печатается в Великом камне",
  shipped: "заказ передан в службу доставки",
  done: "заказ доставлен. Надеемся, он вам понравился!",
};

// Чат-бот по кнопкам. Черновик: ответы собираются из данных заказа, без ИИ.
function ChatBot({ order: o, printDays }) {
  const [msgs, setMsgs] = useState([{ from: "bot", text: "Здравствуйте! Я помогу с заказом. Выберите вопрос." }]);
  const ask = (q) => {
    let a = "";
    if (q === "where") a = `Заказ № ${o.id} сейчас на этапе «${statusLabel(o.status)}»: ${STATUS_TEXT[o.status]}.`;
    if (q === "when")
      a =
        o.status === "done"
          ? "Заказ уже доставлен."
          : `Ориентировочно ${deliveryRange(printDays, new Date(o.createdAt))}. Способ: ${o.delivery.name} (${o.delivery.note}), в пути ${o.delivery.eta}.`;
    if (q === "defect") {
      a = `Нам очень жаль! Брак печати перепечатаем бесплатно. Сфотографируйте брак и напишите нам: support@picpac.by или +375 44 539-67-89 (ежедневно 9:00–21:00). Обращение по заказу № ${o.id} мы уже создали.`;
      const tickets = readKey("tickets", []);
      if (!tickets.some((t) => t.orderId === o.id && t.type === "defect")) {
        writeKey("tickets", [{ id: "T" + Date.now(), orderId: o.id, type: "defect", at: Date.now() }, ...tickets]);
        notify("Обращение «Брак печати» создано", "success");
      }
    }
    const label = { where: "Где мой заказ?", when: "Когда доставят?", defect: "Пришёл брак" }[q];
    setMsgs((m) => [...m, { from: "me", text: label }, { from: "bot", text: a }]);
  };
  return (
    <section className="card">
      <h3 className="row">
        <IconChat size={20} /> Помощь по заказу
      </h3>
      <div className="chat">
        {msgs.map((m, i) => (
          <div key={i} className={"bubble " + m.from}>
            {m.text}
          </div>
        ))}
      </div>
      <div className="row wrap" style={{ marginTop: 12 }}>
        <button className="btn btn-small" onClick={() => ask("where")}>Где мой заказ?</button>
        <button className="btn btn-small" onClick={() => ask("when")}>Когда доставят?</button>
        <button className="btn btn-small" onClick={() => ask("defect")}>Пришёл брак</button>
      </div>
    </section>
  );
}
