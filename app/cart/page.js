"use client";
// Корзина и оформление заказа.
// Гость: корзина на устройстве; «Подтвердить заказ» → вход или регистрация → возврат сюда, корзина и проекты переносятся в аккаунт.
// Вошедший клиент: корзина на сервере (видна с другого устройства). Доставка — из каталога, промокод проверяет сервер,
// итог считается по lib/pricing.js (товары → скидка → доставка → итого) и ещё раз на сервере при оформлении.
// Заказ: POST /api/v1/orders с Idempotency-Key — ключ живёт в IndexedDB до успеха, поэтому повтор, обрыв связи
// и двойное нажатие не создают второй заказ.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { IconImage, IconTrash } from "../../components/icons";
import { clearAfterOrder, moveLocalToServer, removeLine, setLineQuantity, useCart } from "../../lib/cart";
import { FIELD_LABELS, PICKUP_POINTS, formatPhone, needsDate, validateCheckout } from "../../lib/checkout";
import { kvDel, kvGet, kvSet, markOrdered, useDraft } from "../../lib/draft";
import { isClient, useMe } from "../../lib/me";
import { applyPromo, calcTotals, daysWord, etaFromDay, formatEtaRange, linePrice, minskDate } from "../../lib/pricing";
import { notify, readKey, useLocalValue } from "../../lib/store";
import { syncProject, useSyncState } from "../../lib/sync";
import { useCatalog } from "../../lib/useCatalog";

const EMPTY_FORM = { name: "", phone: "", email: "", delivery: "", address: {}, date: "", payment: "card_test", promo: null, saveAddress: true };
const NO_ADDRESSES = [];

const byn = (kop) => (kop / 100).toFixed(2).replace(".", ",") + " BYN";
const sizeText = (s) => (s ? String(s).replace("x", "×") + " см" : "");

export default function CartPage() {
  const router = useRouter();
  const me = useMe();
  const cart = useCart();
  const { projects, thumbs } = useDraft();
  const sync = useSyncState();
  const { data: catalog, error: catalogError, retry: retryCatalog } = useCatalog();
  const [form, setForm] = useLocalValue("checkout", EMPTY_FORM);
  const [addresses, setAddresses] = useLocalValue("addresses", NO_ADDRESSES);
  const [promoInput, setPromoInput] = useState("");
  const [promoMsg, setPromoMsg] = useState(null); // { ok, text }
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null); // текст ошибки оформления + «Повторить»
  const [done, setDone] = useState(null); // оформленный заказ
  const lock = useRef(false);

  const client = isClient(me);
  const update = (patch) => setForm({ ...form, ...patch });
  const setAddr = (k, v) => update({ address: { ...form.address, [k]: v } });

  if (done) return <OrderDone order={done} />;
  if (!cart.ready || !catalog) {
    if (catalogError)
      return (
        <div className="card">
          <h1>Корзина</h1>
          <p className="err-text">Каталог не загрузился. Проверьте интернет.</p>
          <button className="btn" onClick={retryCatalog}>
            Повторить
          </button>
        </div>
      );
    return <p className="muted">Загружаем корзину…</p>;
  }

  // Позиции: серверные (цены посчитал сервер) и с устройства (цена по той же формуле lib/pricing.js)
  const byServerId = new Map(Object.values(projects).filter((p) => p.serverId).map((p) => [p.serverId, p]));
  const onServer = new Set(cart.server.map((i) => i.projectId));
  const lines = [
    ...cart.server.map((i) => {
      const local = byServerId.get(i.projectId);
      return {
        key: "s:" + i.id,
        source: "server",
        serverProjectId: i.projectId,
        localProjectId: local?.id || null,
        title: i.product?.kind === "book" ? "Фотокнига " + (i.product?.name || i.title) : i.product?.name || i.title,
        size: i.options?.size,
        pages: i.product?.kind === "book" ? i.options?.pages : null,
        photoCount: i.photoCount,
        quantity: i.quantity,
        unitKop: i.unitPriceKop,
        lineKop: i.lineTotalKop,
        valid: i.valid,
        printDays: i.product?.printDays || 3,
        thumb: local?.photos[0] ? thumbs[local.photos[0].id] : null,
      };
    }),
    ...cart.local
      .filter((c) => !(cart.mode === "server" && onServer.has(projects[c.projectId]?.serverId)))
      .map((c) => {
        const p = projects[c.projectId];
        const product = catalog.products.find((x) => x.slug === (p?.productSlug || c.productSlug));
        const photoCount = p ? p.photos.filter((x) => x.supported).length : c.photoCount || 0;
        const quantity = c.quantity || 1;
        const sizeCode = p?.sizeId || c.sizeId;
        const pages = p?.pages ?? c.pages;
        const price = product ? linePrice(product, { sizeCode, pages, photoCount, quantity, options: p?.options || c.options }) : null;
        return {
          key: "l:" + c.projectId,
          source: "local",
          localProjectId: c.projectId,
          title: product ? (product.kind === "book" ? "Фотокнига " : "") + product.name : c.name,
          size: sizeCode,
          pages: product?.kind === "book" ? pages : null,
          photoCount,
          quantity,
          unitKop: price?.unitKop ?? null,
          lineKop: price?.lineKop ?? null,
          valid: !!price,
          printDays: product?.printDays || 3,
          thumb: p?.photos[0] ? thumbs[p.photos[0].id] : c.cover || null,
          pending: cart.mode === "server",
        };
      }),
  ];

  if (!lines.length)
    return (
      <div className="card">
        <h1>Корзина пуста</h1>
        <p className="muted">Соберите фотокнигу или закажите печать фото — это займёт пару минут.</p>
        <Link href="/" className="btn btn-primary">
          В каталог
        </Link>
      </div>
    );

  // Расчёт: товары → скидка промокода → доставка (бесплатно от порога после скидки) → итого
  const method = catalog.delivery.find((d) => d.code === form.delivery) || null;
  const goodsLines = lines.filter((l) => l.valid).map((l) => ({ lineKop: l.lineKop }));
  const totals = calcTotals({ lines: goodsLines, method, promo: form.promo });
  const promoNow = form.promo ? applyPromo(form.promo, totals.goodsKop) : null;
  const printDays = Math.max(...lines.map((l) => l.printDays));
  const today = minskDate();
  const eta = method ? etaFromDay(today, printDays, method.minDays, method.maxDays) : null;
  const pending = lines.filter((l) => l.pending);
  const uploading = pending
    .map((l) => sync.projects[l.localProjectId])
    .filter((s) => s?.state === "syncing" && s.total)
    .reduce((a, s) => ({ done: a.done + s.done, total: a.total + s.total }), { done: 0, total: 0 });

  async function applyPromoCode() {
    const code = promoInput.trim();
    if (!code) return setPromoMsg({ ok: false, text: "Введите промокод." });
    const r = await fetch("/api/v1/promo/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, subtotal: totals.goodsKop / 100 }),
    })
      .then(async (res) => ({ status: res.status, ...(await res.json().catch(() => ({}))) }))
      .catch(() => ({ status: 0 }));
    if (r.ok && r.valid !== false) {
      update({ promo: r.promo });
      setPromoInput("");
      setPromoMsg({ ok: true, text: `${r.message}: ${r.promo.code}${r.promo.label ? " — " + r.promo.label : ""}` });
    } else {
      setPromoMsg({ ok: false, text: r.status === 0 ? "Нет связи с сервером. Попробуйте ещё раз." : r.message || r.error?.message || "Не подходит." });
    }
  }

  function pickAddress(a) {
    update({ delivery: a.delivery, address: { ...a.address } });
  }

  async function confirm() {
    if (lock.current) return;
    setFailure(null);
    if (me && !me.authenticated) {
      // Корзина, проекты и форма сохранены на устройстве — после входа или регистрации вернёмся сюда
      router.push("/login?reason=checkout&next=" + encodeURIComponent("/cart"));
      return;
    }
    const minDate = eta?.from;
    const errs = validateCheckout(form, method, minDate);
    if (lines.some((l) => !l.valid)) errs.cart = "В корзине есть позиция, которую нельзя заказать: откройте проект и выберите вариант заново.";
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      document.getElementById("f-" + first)?.focus();
      return;
    }
    if (!client) {
      setFailure("Заказ оформляет клиент. Сейчас вы вошли как сотрудник — войдите под аккаунтом клиента.");
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      // 1. Позиции с устройства — в серверную корзину (проект и фото уходят на сервер)
      await moveLocalToServer();
      if (readKey("cart", []).some((c) => c?.projectId)) throw new Error(navigator.onLine === false ? "offline" : "Ещё не все фото загрузились. Подождите немного и нажмите «Повторить».");
      // 2. Свежие настройки проектов корзины — на сервер (цену посчитает сервер)
      for (const l of lines) if (l.localProjectId) await syncProject(l.localProjectId);
      // 3. Заказ с ключом идемпотентности
      let key = await kvGet("checkoutKey").catch(() => null);
      if (!key) {
        key = "co-" + crypto.randomUUID();
        await kvSet("checkoutKey", key).catch(() => {});
      }
      const address = Object.fromEntries((method.addressFields || []).map((f) => [f, String(form.address?.[f] || "").trim()]));
      if (needsDate(method)) address.date = form.date;
      const body = {
        delivery: { code: method.code, address },
        recipient: { name: form.name.trim(), phone: form.phone, ...(form.email?.trim() ? { email: form.email.trim() } : {}) },
        paymentMethod: form.payment,
        ...(form.promo && promoNow?.ok ? { promoCode: form.promo.code } : {}),
      };
      let res;
      try {
        res = await fetch("/api/v1/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(body),
        });
      } catch {
        throw new Error("offline");
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const fields = data?.error?.fields || {};
        const mapped = {};
        for (const [k, v] of Object.entries(fields)) mapped[k.replace("delivery.address.", "").replace("recipient.", "").replace("delivery.code", "delivery")] = v;
        setErrors(mapped);
        if (data?.error?.code === "cart_changed" || data?.error?.code === "cart_empty") await kvDel("checkoutKey").catch(() => {});
        throw new Error(data?.error?.message || "Сервер не ответил. Попробуйте ещё раз.");
      }
      const order = data.order;
      // 4. Тестовая оплата: деньги не списываются
      const paid = await fetch(`/api/v1/orders/${order.id}/pay-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: form.payment }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      await kvDel("checkoutKey").catch(() => {});
      // 5. Проекты заказа — в «Заказанные», корзина пуста, адрес — в сохранённые
      const localIds = lines.map((l) => l.localProjectId).filter(Boolean);
      await markOrdered(localIds, { orderId: order.id, number: order.number }).catch(console.error);
      clearAfterOrder();
      if (form.saveAddress && method.addressFields.length) {
        const label = method.addressFields.map((f) => address[f]).filter(Boolean).join(", ");
        const rest = addresses.filter((a) => a.label !== label || a.delivery !== method.code);
        setAddresses([{ delivery: method.code, label, address: Object.fromEntries(method.addressFields.map((f) => [f, address[f]])) }, ...rest].slice(0, 5));
      }
      setForm({ ...form, promo: null, date: "" });
      setDone({ ...order, paid, paymentMethod: form.payment });
      notify(`Заказ ${order.number} оформлен`, "success");
    } catch (e) {
      lock.current = false;
      setFailure(
        e.message === "offline"
          ? "Нет связи с сервером. Данные формы сохранены — нажмите «Повторить», когда появится интернет. Второй заказ не создастся."
          : e.message,
      );
    } finally {
      setBusy(false);
    }
  }

  const err = (k) =>
    errors[k] ? (
      <span className="err-text small" id={"e-" + k} role="alert">
        {errors[k]}
      </span>
    ) : null;
  const field = (k, label, props = {}) => (
    <label className="field" key={k}>
      <span>{label}</span>
      <input
        id={"f-" + k}
        className="input"
        value={form.address?.[k] || ""}
        onChange={(e) => setAddr(k, k === "postcode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value)}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? "e-" + k : undefined}
        {...props}
      />
      {err(k)}
    </label>
  );

  return (
    <div>
      <h1>Корзина</h1>
      {cart.error && <p className="warn-text small">{cart.error}</p>}
      {pending.length > 0 && (
        <p className="muted small" role="status">
          Переносим в аккаунт: {uploading.total ? `загружено фото ${uploading.done} из ${uploading.total}` : "сохраняем проект"}…
        </p>
      )}
      {lines.map((l) => (
        <div key={l.key} className="card row" style={{ gap: 12, alignItems: "flex-start" }}>
          {l.thumb ? (
            <img src={l.thumb} alt="" className="issue-thumb" />
          ) : (
            <div className="issue-thumb row" style={{ justifyContent: "center" }}>
              <IconImage />
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ color: "var(--ds-color-text-strong)" }}>{l.title}</b>
            <div className="muted small">
              {sizeText(l.size)}
              {l.pages ? ` · ${l.pages} стр.` : ""} · {l.photoCount} фото
            </div>
            {!l.valid && <p className="err-text small">Этот вариант нельзя заказать — откройте проект и выберите размер заново.</p>}
            <div className="row" style={{ gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <div className="stepper" role="group" aria-label={"Количество: " + l.title}>
                <button className="btn btn-small" aria-label="Меньше" disabled={l.quantity <= 1} onClick={() => setLineQuantity(l, l.quantity - 1)}>
                  −
                </button>
                <output aria-live="polite">{l.quantity}</output>
                <button className="btn btn-small" aria-label="Больше" disabled={l.quantity >= 99} onClick={() => setLineQuantity(l, l.quantity + 1)}>
                  +
                </button>
              </div>
              <b>{l.lineKop == null ? "—" : byn(l.lineKop)}</b>
            </div>
          </div>
          <button className="icon-btn" aria-label={"Убрать из корзины: " + l.title} onClick={() => removeLine(l)}>
            <IconTrash size={18} />
          </button>
        </div>
      ))}

      <section className="card" aria-labelledby="h-recipient">
        <h2 id="h-recipient">Получатель</h2>
        <label className="field">
          <span>Имя и фамилия</span>
          <input id="f-name" className="input" autoComplete="name" value={form.name} onChange={(e) => update({ name: e.target.value })} aria-invalid={!!errors.name} />
          {err("name")}
        </label>
        <label className="field">
          <span>Телефон</span>
          <input
            id="f-phone"
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+375 (29) 123-45-67"
            value={form.phone}
            onChange={(e) => update({ phone: formatPhone(e.target.value) })}
            aria-invalid={!!errors.phone}
          />
          {err("phone")}
        </label>
        <label className="field">
          <span>Почта (необязательно)</span>
          <input
            id="f-email"
            className="input"
            type="email"
            autoComplete="email"
            placeholder={me?.user?.email || "name@example.com"}
            value={form.email}
            onChange={(e) => update({ email: e.target.value })}
            aria-invalid={!!errors.email}
          />
          {err("email")}
        </label>
      </section>

      <section className="card" aria-labelledby="h-delivery">
        <h2 id="h-delivery">Способ получения</h2>
        {addresses.length > 0 && (
          <div className="row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <span className="muted small">Сохранённые адреса:</span>
            {addresses.map((a) => (
              <button key={a.delivery + a.label} className="btn btn-small" onClick={() => pickAddress(a)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
        <div role="radiogroup" aria-label="Способ получения" id="f-delivery" tabIndex={-1}>
          {catalog.delivery.map((d) => {
            const free = totals.promo?.ok && totals.promo.freeDelivery ? true : d.freeFromKop != null && totals.goodsKop - totals.discountKop >= d.freeFromKop;
            return (
              <label key={d.code} className={"radio-row" + (d.code === form.delivery ? " selected" : "")}>
                <input type="radio" name="delivery" checked={d.code === form.delivery} onChange={() => update({ delivery: d.code })} />
                <div style={{ flex: 1 }}>
                  <b style={{ color: "var(--ds-color-text-strong)" }}>{d.name}</b> <span className="muted small">{d.note}</span>
                  <div className="muted small">
                    {d.eta}
                    {d.freeFromKop != null && ` · бесплатно от ${byn(d.freeFromKop)}`}
                  </div>
                </div>
                <b className={free ? "ok-text" : ""}>{free ? "бесплатно" : byn(d.priceKop)}</b>
              </label>
            );
          })}
        </div>
        {err("delivery")}
        {method && (
          <div style={{ marginTop: 12 }}>
            {method.addressFields.includes("pickup_point") && (
              <label className="field">
                <span>Пункт выдачи Европочты (тестовый список)</span>
                <select id="f-pickup_point" className="input" value={form.address?.pickup_point || ""} onChange={(e) => setAddr("pickup_point", e.target.value)} aria-invalid={!!errors.pickup_point}>
                  <option value="">Выберите пункт</option>
                  {PICKUP_POINTS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                {err("pickup_point")}
              </label>
            )}
            {method.addressFields.includes("postcode") && field("postcode", "Индекс отделения Белпочты", { inputMode: "numeric", placeholder: "220030", autoComplete: "postal-code" })}
            {method.addressFields.includes("city") && field("city", FIELD_LABELS.city, { autoComplete: "address-level2" })}
            {method.addressFields.includes("street") && field("street", FIELD_LABELS.street, { autoComplete: "address-line1" })}
            <div className="row" style={{ gap: 12 }}>
              {method.addressFields.includes("house") && <div style={{ flex: 1 }}>{field("house", FIELD_LABELS.house)}</div>}
              {method.addressFields.includes("flat") && <div style={{ flex: 1 }}>{field("flat", FIELD_LABELS.flat)}</div>}
            </div>
            {needsDate(method) && (
              <label className="field">
                <span>Дата доставки</span>
                <input id="f-date" className="input" type="date" min={eta?.from} value={form.date || ""} onChange={(e) => update({ date: e.target.value })} aria-invalid={!!errors.date} />
                {err("date")}
              </label>
            )}
            {method.addressFields.length > 0 && (
              <label className="row small" style={{ gap: 8 }}>
                <input type="checkbox" checked={!!form.saveAddress} onChange={(e) => update({ saveAddress: e.target.checked })} />
                Сохранить адрес
              </label>
            )}
          </div>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          {eta
            ? `Напечатаем за ${daysWord(printDays)} — доставим ориентировочно ${formatEtaRange(eta.from, eta.to)}.`
            : `Напечатаем за ${daysWord(printDays)}. Выберите способ получения — покажем дату доставки.`}
        </p>
      </section>

      <section className="card" aria-labelledby="h-promo">
        <h2 id="h-promo">Промокод</h2>
        {form.promo ? (
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="chip chip-ok">{form.promo.code}</span>
            <span className="small">{form.promo.label}</span>
            <button
              className="btn btn-small"
              onClick={() => {
                update({ promo: null });
                setPromoMsg(null);
              }}
            >
              Убрать
            </button>
          </div>
        ) : (
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input"
              placeholder="Например, TEST10"
              value={promoInput}
              onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
              aria-label="Промокод"
              onKeyDown={(e) => e.key === "Enter" && applyPromoCode()}
            />
            <button className="btn btn-small" onClick={applyPromoCode}>
              Применить
            </button>
          </div>
        )}
        {promoMsg && (
          <p className={(promoMsg.ok ? "ok-text" : "err-text") + " small"} role="status" style={{ marginTop: 6 }}>
            {promoMsg.text}
          </p>
        )}
        {form.promo && promoNow && !promoNow.ok && (
          <p className="err-text small" role="status" style={{ marginTop: 6 }}>
            {promoNow.message}
          </p>
        )}
      </section>

      <section className="card" aria-labelledby="h-pay">
        <h2 id="h-pay">Оплата</h2>
        <div role="radiogroup" aria-label="Тестовая оплата" id="f-payment" tabIndex={-1}>
          {[
            ["card_test", "Карта (тест)"],
            ["erip_test", "ЕРИП (тест)"],
          ].map(([id, label]) => (
            <label key={id} className={"radio-row" + (form.payment === id ? " selected" : "")}>
              <input type="radio" name="payment" checked={form.payment === id} onChange={() => update({ payment: id })} />
              <b style={{ flex: 1, color: "var(--ds-color-text-strong)" }}>{label}</b>
            </label>
          ))}
        </div>
        {err("payment")}
        <p className="muted small">Деньги не списываются: оплата тестовая, данные карты не нужны.</p>
      </section>

      <section className="card" aria-labelledby="h-total">
        <h2 id="h-total">Итого</h2>
        <div className="sum-line">
          <span>Товары</span>
          <span>{byn(totals.goodsKop)}</span>
        </div>
        <div className={"sum-line" + (totals.discountKop ? " ok-text" : "")}>
          <span>Скидка{totals.promo?.ok ? " " + totals.promo.code : ""}</span>
          <span>{totals.discountKop ? "−" + byn(totals.discountKop) : byn(0)}</span>
        </div>
        <div className="sum-line">
          <span>Доставка</span>
          <span>{!method ? "выберите способ" : totals.deliveryKop === 0 ? "бесплатно" : byn(totals.deliveryKop)}</span>
        </div>
        <div className="sum-line sum-total">
          <span>Итого</span>
          <span>{byn(totals.totalKop)}</span>
        </div>
        {err("cart")}
        {me && !me.authenticated && (
          <p className="muted small">Чтобы подтвердить заказ, войдите или зарегистрируйтесь — после входа вернём вас сюда, корзина и проекты сохранятся.</p>
        )}
        {client && <p className="muted small">Заказ оформляется на {me.user.name || me.user.email}.</p>}
        {failure && (
          <p className="err-text small" role="alert">
            {failure}
          </p>
        )}
        <button className="btn btn-primary btn-block" onClick={confirm} disabled={busy} aria-busy={busy} style={{ marginTop: 8 }}>
          {busy ? (pending.length ? "Загружаем фото…" : "Оформляем…") : failure ? "Повторить" : "Подтвердить заказ"}
        </button>
      </section>
    </div>
  );
}

function OrderDone({ order }) {
  const from = order.eta?.from ? minskDate(new Date(order.eta.from)) : null;
  const to = order.eta?.to ? minskDate(new Date(order.eta.to)) : null;
  return (
    <div className="card stack" role="status">
      <h1>Заказ оформлен</h1>
      <p style={{ fontSize: "1.375rem", fontWeight: 500, color: "var(--ds-color-text-strong)" }}>№ {order.number}</p>
      {from && to && <p>Доставим ориентировочно {formatEtaRange(from, to)}.</p>}
      <p>
        Итого {byn(order.totalKop)} ·{" "}
        {order.paid ? `оплачено: ${order.paymentMethod === "erip_test" ? "ЕРИП (тест)" : "Карта (тест)"}` : "оплата не прошла — повторите в заказе"}. Деньги не списываются.
      </p>
      <p className="muted small">Статус заказа — «{order.statusLabel || "Принят"}». Книга теперь в «Мои книги» → «Заказанные».</p>
      <Link href={"/orders/" + order.id} className="btn btn-primary btn-block">
        Открыть заказ
      </Link>
      <Link href="/" className="btn btn-block">
        В каталог
      </Link>
    </div>
  );
}
