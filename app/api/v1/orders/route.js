// /api/v1/orders — мои заказы.
// GET — список. POST — оформить заказ из корзины на сервере. Заголовок Idempotency-Key обязателен:
// повтор с тем же ключом вернёт тот же заказ, второй не создастся. Цены и итог считает сервер —
// суммы из запроса не читаются. Оплата только тестовая, деньги не списываются.
import { calcTotals, etaRange, minskDayStart } from "@/lib/pricing";
import { parseBody, rateLimited, requireUser, serverError, tooMany, z } from "@/lib/server/api";
import { findDelivery, findPromo } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { getOwnOrder, loadOrderFull, ORDER_FIELDS, shapeOrder } from "@/lib/server/orders";
import { loadCart } from "@/lib/server/projects";

const text = (max, msg) => z.string().trim().max(max, msg);
const schema = z.object({
  delivery: z.object({
    code: z.string().regex(/^[a-z0-9-]{2,30}$/, "Выберите способ доставки."),
    address: z
      .object({
        city: text(80, "Город — до 80 символов.").optional(),
        street: text(120, "Улица — до 120 символов.").optional(),
        house: text(20, "Дом — до 20 символов.").optional(),
        flat: text(20, "Квартира — до 20 символов.").optional(),
        postcode: z.string().trim().regex(/^\d{6}$/, "Индекс — 6 цифр.").optional(),
        pickup_point: text(120, "Пункт выдачи — до 120 символов.").optional(),
      })
      .default({}),
  }),
  recipient: z.object({
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
  const { data, error } = await ctx.db
    .from("orders")
    .select(`${ORDER_FIELDS}, order_items(count)`)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return serverError();
  return json({ ok: true, items: data.map((o) => ({ ...shapeOrder(o), itemsCount: o.order_items?.[0]?.count || 0 })) });
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
    return json({ ok: true, replayed: true, order: await loadOrderFull(ctx, existing) });
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
  if (body.promoCode) {
    promo = await findPromo(body.promoCode);
    if (!promo) return jsonError(422, "promo_not_found", "Не подходит: такого промокода нет. Уберите его или введите другой.");
  }
  const now = new Date();
  const lines = cart.items.map((i) => ({ lineKop: i.lineTotalKop }));
  const totals = calcTotals({ lines, method, promo, now });
  if (promo && !totals.promo.ok) return jsonError(422, `promo_${totals.promo.reason}`, totals.promo.message);

  const printDays = Math.max(...cart.items.map((i) => i.product?.printDays || 0));
  const eta = etaRange(now, printDays, method.minDays, method.maxDays);
  const address = Object.fromEntries(method.addressFields.map((f) => [f, body.delivery.address[f]]));
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

  const { data: rows, error } = await ctx.admin.rpc("create_order", { _user: ctx.userId, _key: key, _order: orderRow, _items: items });
  if (error || !rows?.[0]?.order_id) {
    console.error(error?.message);
    await ctx.audit("order.create", "order", null, "error", { reason: "db_error" });
    return serverError("order_failed", "Не получилось оформить заказ. Деньги не списывались. Попробуйте ещё раз.");
  }
  const { order_id: orderId, created } = rows[0];
  const order = await getOwnOrder(ctx, orderId);
  await ctx.audit("order.create", "order", order.number, "success", {
    replayed: !created,
    total_kop: order.total_kop,
    items: items.length,
    promo: order.promo_code,
    delivery: order.delivery_code,
  });
  return json({ ok: true, replayed: !created, order: await loadOrderFull(ctx, order) }, created ? 201 : 200);
}
