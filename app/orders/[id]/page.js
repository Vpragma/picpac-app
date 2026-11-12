"use client";
// Экран заказа (ТЗ п. 7): GET /api/v1/orders/{id}. Состав с миниатюрами, суммы, получатель, доставка,
// лента из 5 статусов по Минску, ориентировочная дата, обращения и «Написать в поддержку».
// Пока заказ не завершён, экран обновляется раз в 10 секунд (демо-заказы двигаются по таймеру).
import Link from "next/link";
import { SUPPORT } from "@/lib/support";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { callApi } from "../../../lib/api";
import { getMe } from "../../../lib/me";
import { notify } from "../../../lib/store";
import { StatusChip, Timeline, byn, minskDay, minskTime } from "../../../components/OrderBits";
import { IconChat } from "../../../components/icons";

const POLL_MS = 10000;
const PAY = { card_test: "Карта (тест)", erip_test: "ЕРИП (тест)" };
const ADDRESS = [
  ["pickup_point", "Пункт выдачи"],
  ["postcode", "Индекс"],
  ["city", "Город"],
  ["street", "Улица"],
  ["house", "Дом"],
  ["flat", "Квартира"],
];
const kop = byn;

export default function OrderPage() {
  const { id } = useParams();
  const [res, setRes] = useState(null);
  const [isNew, setIsNew] = useState(false);

  const load = useCallback(async () => {
    const m = await getMe();
    const r = m?.authenticated
      ? await callApi(`/api/v1/orders/${encodeURIComponent(id)}`, { method: "GET" })
      : { status: m?.unknown ? 0 : 401, ok: false, error: { message: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." } };
    setRes((prev) => (r.status === 0 && prev?.ok ? prev : r));
    setIsNew(window.location.search.includes("new=1"));
    return r;
  }, [id]);

  const done = res?.order?.status === "done";
  useEffect(() => {
    let alive = true;
    const tick = () => alive && load();
    tick();
    if (done) return () => (alive = false);
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load, done]);

  if (!res) return <p className="muted">Загружаем заказ…</p>;
  if (res.status === 401)
    return (
      <div className="card stack">
        <h1>Заказ</h1>
        <p>Заказы хранятся в аккаунте. Войдите, чтобы открыть заказ.</p>
        <Link href={`/login?next=/orders/${encodeURIComponent(id)}`} className="btn btn-primary btn-block">
          Войти
        </Link>
      </div>
    );
  if (!res.ok)
    return (
      <div className="card stack">
        <h1>{res.status === 404 ? "Заказ не найден" : "Не получилось открыть заказ"}</h1>
        <p className="muted">{res.status === 404 ? "Проверьте ссылку или откройте заказ из списка." : res.error?.message}</p>
        {res.status !== 404 && (
          <button type="button" className="btn btn-primary btn-block" onClick={() => load()}>
            Повторить
          </button>
        )}
        <Link href="/orders" className="btn btn-block">
          Мои заказы
        </Link>
      </div>
    );

  const o = res.order;
  const addr = o.delivery?.address || {};
  return (
    <div>
      <Link href="/orders" className="back-link">
        ← Мои заказы
      </Link>
      {isNew && (
        <div className="card" style={{ background: "var(--ds-gradient-selected)", marginTop: 8 }} role="status">
          <h2>Спасибо! Заказ принят</h2>
          <p>
            Номер заказа: <b>{o.number}</b>. Статус меняется здесь — экран обновляется сам.
          </p>
        </div>
      )}
      <div className="row between" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }} data-testid="order-number">
          № {o.number}
        </h1>
        <StatusChip status={o.status} />
      </div>
      <p className="muted small">
        Оформлен {minskTime(o.createdAt, true)} · доставим ориентировочно {minskDay(o.eta?.from)}
        {o.eta?.to && o.eta.to !== o.eta.from ? `–${minskDay(o.eta.to)}` : ""}
      </p>

      <section className="card">
        <h3>Статус</h3>
        <Timeline order={o} />
        {o.isDemo && o.status !== "done" && <p className="muted small">Демо-заказ: статус сам переходит дальше примерно каждые 30 секунд после оплаты.</p>}
      </section>

      <section className="card">
        <h3>Состав</h3>
        {(o.items || []).map((i) => (
          <div key={i.id} className="stack" style={{ marginBottom: 12 }}>
            <div className="sum-line">
              <b>
                {i.title}
                {i.quantity > 1 ? ` × ${i.quantity}` : ""}
              </b>
              <span>{kop(i.lineTotalKop)}</span>
            </div>
            <div className="muted small">
              {i.snapshot?.productName ? `${i.snapshot.productName} · ` : ""}
              {(i.optionsText || []).join(" · ")} · {i.photoCount} фото
            </div>
            {!!i.thumbs?.length && (
              <div className="row wrap" style={{ gap: 6 }} aria-label="Миниатюры фото">
                {i.thumbs.map((t) =>
                  t.url ? (
                    // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка на 10 минут, оптимизатор не нужен
                    <img key={t.id} src={t.url} alt="" width="56" height="56" loading="lazy" style={{ objectFit: "cover", borderRadius: 8, width: 56, height: 56 }} />
                  ) : (
                    <span key={t.id} style={{ width: 56, height: 56, borderRadius: 8, background: "var(--ds-color-bg-muted)" }} />
                  ),
                )}
                {i.photoCount > i.thumbs.length && <span className="muted small">и ещё {i.photoCount - i.thumbs.length}</span>}
              </div>
            )}
          </div>
        ))}
        <div className="sum-line">
          <span>Товары</span>
          <span>{kop(o.goodsKop)}</span>
        </div>
        {o.discountKop > 0 && (
          <div className="sum-line ok-text">
            <span>Скидка {o.promoCode}</span>
            <span>−{kop(o.discountKop)}</span>
          </div>
        )}
        <div className="sum-line">
          <span>Доставка</span>
          <span>{o.deliveryKop ? kop(o.deliveryKop) : "бесплатно"}</span>
        </div>
        <div className="sum-line sum-total">
          <span>Итого</span>
          <span>{kop(o.totalKop)}</span>
        </div>
        <p className="muted small">
          Оплата: {PAY[o.payment?.method] || "тестовая"} — {o.payment?.status === "paid_test" ? "оплачено (тест)" : "ждёт оплаты"}. Деньги не списываются.
        </p>
      </section>

      <section className="card">
        <h3>Получатель и доставка</h3>
        <p style={{ margin: 0 }}>
          {o.recipient?.name} · {o.recipient?.phone}
          {o.recipient?.email ? ` · ${o.recipient.email}` : ""}
        </p>
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          {o.delivery?.name || o.delivery?.code}
          {ADDRESS.filter(([k]) => addr[k]).map(([k, label]) => ` · ${label}: ${addr[k]}`)}
          {addr.date ? ` · День доставки: ${minskDay(addr.date + "T12:00:00+03:00")}` : ""}
        </p>
      </section>

      <Support order={o} onCreated={load} />
    </div>
  );
}

const TOPICS = ["Где мой заказ?", "Изменить доставку", "Брак печати — нужна перепечатка", "Другой вопрос"];

// Обращения по заказу: список, переписка и «Написать в поддержку» (первый ответ — бот, дальше оператор, S06)
function Support({ order: o, onCreated }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [threads, setThreads] = useState({}); // id → сообщения

  async function send(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const kind = topic.startsWith("Брак") ? "reprint" : "support";
    const r = await callApi(`/api/v1/orders/${o.id}/interactions`, { body: { topic, kind, message } });
    setBusy(false);
    if (!r.ok) return setError(r.error?.message || "Не получилось отправить. Попробуйте ещё раз.");
    setThreads((t) => ({ ...t, [r.interaction.id]: r.messages }));
    setMessage("");
    setOpen(false);
    notify("Обращение отправлено", "success");
    onCreated();
  }

  async function show(id) {
    if (threads[id]) return setThreads((t) => ({ ...t, [id]: undefined }));
    const r = await callApi(`/api/v1/interactions/${id}/messages`, { method: "GET" });
    if (r.ok) setThreads((t) => ({ ...t, [id]: r.messages }));
    else notify(r.error?.message || "Не получилось загрузить переписку.", "error");
  }

  const list = o.interactions || [];
  return (
    <section className="card" aria-labelledby="support-title">
      <h3 id="support-title" className="row">
        <IconChat size={20} /> Обращения по заказу
      </h3>
      {!list.length && <p className="muted small">Обращений пока нет. Вопрос по заказу — напишите нам, ответим в течение суток.</p>}
      {list.map((it) => (
        <div key={it.id} className="stack" style={{ borderTop: "1px solid var(--ds-color-border, #ddd)", paddingTop: 8, marginTop: 8 }} data-testid="interaction">
          <div className="row between">
            <b>{it.topic}</b>
            <span className="chip">{it.status === "open" ? "Ждёт ответа" : it.status === "answered" ? "Есть ответ" : "Закрыто"}</span>
          </div>
          <div className="muted small">
            {minskTime(it.createdAt)} · ответим до {minskTime(it.slaDue)}
          </div>
          <button type="button" className="btn btn-small" onClick={() => show(it.id)} aria-expanded={!!threads[it.id]}>
            {threads[it.id] ? "Скрыть переписку" : "Показать переписку"}
          </button>
          {threads[it.id] && (
            <div className="chat">
              {threads[it.id].map((m) => (
                <div key={m.id} className={"bubble " + (m.author === "client" ? "me" : "bot")}>
                  {m.body}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {!open ? (
        <button type="button" className="btn btn-primary btn-block" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
          Написать в поддержку
        </button>
      ) : (
        <form className="stack" style={{ marginTop: 12 }} onSubmit={send}>
          <label className="field">
            <span>Тема</span>
            <select className="input" value={topic} onChange={(e) => setTopic(e.target.value)}>
              {TOPICS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Сообщение</span>
            <textarea className="input" rows={4} maxLength={2000} required value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Опишите вопрос. Для брака приложите фото в ответе оператору." />
          </label>
          {error && (
            <p className="err-text" role="alert">
              {error}
            </p>
          )}
          <div className="row wrap">
            <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
              {busy ? "Отправляем…" : "Отправить"}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)} disabled={busy}>
              Отмена
            </button>
          </div>
        </form>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Или напрямую: <a href={SUPPORT.emailHref}>{SUPPORT.email}</a> · <a href={SUPPORT.phoneHref}>{SUPPORT.phone}</a>, ежедневно {SUPPORT.hours}
      </p>
    </section>
  );
}
