// /api/v1/orders — мои заказы.
// GET — список. POST — оформить заказ из корзины на сервере. Заголовок Idempotency-Key обязателен:
// повтор с тем же ключом вернёт тот же заказ, второй не создастся. Цены и итог считает сервер —
// суммы из запроса не читаются. Оплата только тестовая, деньги не списываются.
// Промокод (N8) проверяет сервер по корзине (срок, сезон, продукты, сумма, личный код, лимиты), а применение
// записывается атомарно вместе с заказом (create_order_promo): двойное нажатие и повтор не тратят лимит дважды.
// К каждому новому заказу — открытка с личным кодом на следующий заказ (order.card).
import { calcTotals, etaRange, minskDayStart } from "@/lib/pricing";
import { parseBody, rateLimited, requireUser, serverError, tooMany, z } from "@/lib/server/api";
import { findDelivery } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { advanceDemoOrders } from "@/lib/server/orderFlow";
import { getOwnOrder, loadOrderFull, ORDER_FIELDS, shapeOrder } from "@/lib/server/orders";
import { loadCart } from "@/lib/server/projects";
import { cardsByOrder, cardTerms, currentSeason, findPromoFull, issueCard, promoUsage } from "@/lib/server/promo";
import { trackServer } from "@/lib/server/analytics";

// Отказы базы при применении кода (вторая линия, create_order_promo) → понятный текст
const PROMO_DB_ERRORS = {
  promo_not_found: "Не подходит: такого промокода нет. Уберите его или введите другой.",
  promo_disabled: "Не подходит: этот промокод больше не действует.",
  promo_not_started: "Не подходит: промокод ещё не действует.",
  promo_expired: "Истёк: срок действия промокода закончился.",
  promo_not_yours: "Не подходит: это личный код другого клиента.",
  promo_used: "Код уже использован: личный код из открытки действует один раз.",
  promo_limit: "Лимит использований исчерпан: промокод уже применили максимальное число раз.",
  promo_limit_user: "Код уже использован: вы применили его максимальное число раз.",
};

const text = (max, msg) => z.string().trim().max(max, msg);
const schema = z.strictObject({
  delivery: z.strictObject({
    code: z.string().regex(/^[a-z0-9-]{2,30}$/, "Выберите способ доставки."),
    address: z
      .strictObject({
        city: text(80, "Город — до 80 символов.").optional(),
        street: text(120, "Улица — до 120 символов.").optional(),
        house: text(20, "Дом — до 20 символов.").optional(),
        flat: text(20, "Квартира — до 20 символов.").optional(),
        postcode: z.string().trim().regex(/^\d{6}$/, "Индекс — 6 цифр.").optional(),
        pickup_point: text(120, "Пункт выдачи — до 120 символов.").optional(),
        // Курьер: день доставки (YYYY-MM-DD)
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Дата доставки — в формате ГГГГ-ММ-ДД.").optional(),
      })
      .default({}),
  }),
  recipient: z.strictObject({
    name: z.string().trim().min(2, "Введите имя получателя.").max(100, "Имя — до 100 символов."),
    phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, "Телефон в формате +375 29 123-45-67."),
    email: z.string().trim().email("Почта в формате name@example.com.").max(200).optional(),
  }),
  promoCode: z.string().trim().max(30).optional(),
  paymentMethod: z.enum(["card_test", "erip_test"], { error: "Выберите тестовую оплату: карта или ЕРИП." }).optional(),
});

const ADDRESS_LABELS = { city: "город", street: "улицу", house: "дом", flat: "квартиру", postcode: "индекс", pickup_point: "пункт выдачи" };

export async function GET(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const list = () =>
    ctx.db
      .from("orders")
      .select(`${ORDER_FIELDS}, order_items(title, quantity)`)
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(100);
  let { data, error } = await list();
  if (error) return serverError();
  // Демо-заказы: статусы двигает симулятор ERP (lib/server/orderFlow.js)
  const moving = data.filter((o) => o.is_demo && o.status !== "done");
  if (moving.length) {
    if (await advanceDemoOrders(ctx, moving)) ({ data, error } = await list());
    if (error) return serverError();
  }
  // Открытки с личными кодами (N8): код виден и в «Мои заказы»
  const cards = await cardsByOrder(ctx.userId, data.map((o) => o.id), ctx.admin).catch(() => ({}));
  return json({
    ok: true,
    items: data.map((o) => ({
      ...shapeOrder(o),
      itemsCount: o.order_items?.length || 0,
      titles: (o.order_items || []).map((i) => i.title),
      card: cards[o.id] || null,
    })),
  });
}

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;

  const key = request.headers.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) {
    return jsonError(400, "idempotency_key_required", "Нужен заголовок Idempotency-Key (8–100 символов: буквы, цифры, - _ . :). Он защищает от двойного заказа.");
  }
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  // Повтор того же запроса: возвращаем уже созданный заказ
  const { data: existing } = await ctx.db.from("orders").select(ORDER_FIELDS).eq("user_id", ctx.userId).eq("idempotency_key", key).maybeSingle();
  if (existing) {
    await ctx.audit("order.create", "order", existing.number, "success", { replayed: true });
    return json({ ok: true, replayed: true, order: await withCard(ctx, await loadOrderFull(ctx, existing)) });
  }
  if (await rateLimited(`order:${ctx.userId}`, 10, 60)) return tooMany();

  let cart;
  try {
    cart = await loadCart(ctx);
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
  if (!cart.items.length) return jsonError(409, "cart_empty", "Корзина пуста. Добавьте книгу или фото, чтобы оформить заказ.");
  const broken = cart.items.find((i) => !i.valid);
  if (broken) return jsonError(409, "cart_invalid", `Позицию «${broken.title}» нельзя заказать: её вариант пропал из каталога. Откройте проект и выберите вариант заново.`);
  const empty = cart.items.find((i) => i.photoCount === 0);
  if (empty) return jsonError(409, "project_empty", `В проекте «${empty.title}» нет фото. Добавьте фото или уберите его из корзины.`);

  const method = findDelivery(cart.catalog, body.delivery.code);
  if (!method) return jsonError(400, "invalid_input", "Такого способа доставки нет.", { fields: { "delivery.code": "Выберите способ доставки." } });
  const missing = method.addressFields.filter((f) => !body.delivery.address[f]);
  if (missing.length) {
    const fields = Object.fromEntries(missing.map((f) => [`delivery.address.${f}`, `Укажите ${ADDRESS_LABELS[f] || f}.`]));
    return jsonError(400, "invalid_input", `Для доставки «${method.name}» укажите: ${missing.map((f) => ADDRESS_LABELS[f] || f).join(", ")}.`, { fields });
  }

  let promo = null;
  let check = {};
  if (body.promoCode) {
    promo = await findPromoFull(body.promoCode);
    if (!promo) return jsonError(422, "promo_not_found", "Не подходит: такого промокода нет. Уберите его или введите другой.");
    const [usage, season] = await Promise.all([promoUsage(promo.code, ctx.userId), promo.season ? currentSeason() : null]);
    check = { userId: ctx.userId, usage, season, products: cart.catalog.products };
  }
  const now = new Date();
  const lines = cart.items.map((i) => ({ lineKop: i.lineTotalKop, slug: i.product.slug }));
  const totals = calcTotals({ lines, method, promo, now, check });
  if (promo && !totals.promo.ok) {
    await ctx.audit("order.create", "order", null, "denied", { reason: `promo_${totals.promo.reason}`, promo: promo.code });
    return jsonError(422, `promo_${totals.promo.reason}`, totals.promo.message);
  }

  const printDays = Math.max(...cart.items.map((i) => i.product?.printDays || 0));
  const eta = etaRange(now, printDays, method.minDays, method.maxDays);
  const address = Object.fromEntries(method.addressFields.map((f) => [f, body.delivery.address[f]]));
  if (method.code.startsWith("courier")) {
    // Курьер приезжает в выбранный день: не раньше, чем книга будет готова и доедет, и не позже чем через 60 дней
    const date = body.delivery.address.date;
    const last = etaRange(now, 60, 0, 0).from;
    if (!date || date < eta.from || date > last) {
      const msg = !date ? "Выберите дату доставки." : `Выберите дату с ${eta.from.split("-").reverse().join(".")} по ${last.split("-").reverse().join(".")}.`;
      return jsonError(400, "invalid_input", msg, { fields: { "delivery.address.date": msg } });
    }
    address.date = date;
  }
  const orderRow = {
    recipient: { name: body.recipient.name, phone: body.recipient.phone, email: body.recipient.email || ctx.email },
    delivery_code: method.code,
    delivery_address: address,
    goods_kop: totals.goodsKop,
    discount_kop: totals.discountKop,
    delivery_kop: totals.deliveryKop,
    total_kop: totals.totalKop,
    promo_code: totals.promo?.ok ? totals.promo.code : null,
    payment_method: body.paymentMethod || null,
    eta_from: minskDayStart(eta.from),
    eta_to: minskDayStart(eta.to),
    // Все заказы приложения тестовые: статусы двигает симулятор ERP
    is_demo: true,
  };
  const items = cart.items.map((i) => ({
    project_id: i.projectId,
    product_slug: i.product.slug,
    title: i.title,
    options: i.options,
    quantity: i.quantity,
    unit_price_kop: i.unitPriceKop,
    line_total_kop: i.lineTotalKop,
    snapshot: { photoCount: i.photoCount, productName: i.product.name, kind: i.product.kind, printDays: i.product.printDays },
  }));

  // Номер заказа ещё не известен — в подписи открытки он появится по коду; условия открытки решает сервер
  const { data: rows, error } = await ctx.admin.rpc("create_order_promo", { _user: ctx.userId, _key: key, _order: orderRow, _items: items, _card: cardTerms("") });
  if (PROMO_DB_ERRORS[error?.message]) {
    // Код закончился или выключен, пока оформляли (параллельный заказ занял последний лимит)
    await ctx.audit("order.create", "order", null, "denied", { reason: error.message, promo: orderRow.promo_code });
    return jsonError(422, error.message, PROMO_DB_ERRORS[error.message]);
  }
  if (error?.message === "cart_changed") {
    // Параллельный заказ уже оформил эти проекты или корзина изменилась, пока считали цену
    await ctx.audit("order.create", "order", null, "denied", { reason: "cart_changed" });
    return jsonError(409, "cart_changed", "Корзина изменилась или этот заказ уже оформлен. Обновите страницу и проверьте «Мои заказы».");
  }
  if (error || !rows?.[0]?.order_id) {
    console.error(error?.message);
    await ctx.audit("order.create", "order", null, "error", { reason: "db_error" });
    return serverError("order_failed", "Не получилось оформить заказ. Деньги не списывались. Попробуйте ещё раз.");
  }
  const { order_id: orderId, created } = rows[0];
  const order = await getOwnOrder(ctx, orderId);
  // Код открытки совпал с существующим (почти невозможно) — выдать другим кодом; повтор вернёт тот же
  if (created && !rows[0].card_code) await issueCard(ctx.userId, orderId, order.number, ctx.admin).catch((e) => console.error(e?.message));
  await ctx.audit("order.create", "order", order.number, "success", {
    replayed: !created,
    total_kop: order.total_kop,
    items: items.length,
    promo: order.promo_code,
    delivery: order.delivery_code,
  });
  if (created) await trackServer("order_created", ctx.userId, { product: cart.items[0]?.product?.slug || null, items: cart.items.length }, ctx.email);
  return json({ ok: true, replayed: !created, order: await withCard(ctx, await loadOrderFull(ctx, order)) }, created ? 201 : 200);
}

// Заказ + его открытка (личный код на следующий заказ)
async function withCard(ctx, full) {
  const cards = await cardsByOrder(ctx.userId, [full.id], ctx.admin).catch(() => ({}));
  return { ...full, card: cards[full.id] || null };
}
