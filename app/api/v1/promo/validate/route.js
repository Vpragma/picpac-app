// POST /api/v1/promo/validate { code, subtotal?, lines? } — проверить промокод.
// Сумма и состав: для вошедшего клиента — его корзина на сервере (subtotal и lines из запроса не читаются);
// для гостя — subtotal (BYN) и lines [{ slug, kop }] только для предпросмотра: при оформлении заказа сервер
// всё равно пересчитает скидку сам. Проверяются срок, «выключен», сезон, продукты, минимальная сумма,
// лимиты (всего и на клиента) и личные коды (N8). Лимит: 20 проверок в минуту.
import { formatByn } from "@/lib/pricing";
import { publicPromo } from "@/lib/promo";
import { clientIp, writeAudit } from "@/lib/server/audit";
import { parseBody, rateLimited, tooMany, z } from "@/lib/server/api";
import { loadCatalog } from "@/lib/server/catalog";
import { json } from "@/lib/server/http";
import { loadCart } from "@/lib/server/projects";
import { checkPromoForCart } from "@/lib/server/promo";
import { getAuth } from "@/lib/server/session";

const schema = z.strictObject({
  code: z.string().trim().min(1, "Введите промокод.").max(30, "Промокод — до 30 символов."),
  subtotal: z.number().min(0).max(100000).optional(),
  lines: z
    .array(z.strictObject({ slug: z.string().regex(/^[a-z0-9-]{2,40}$/), kop: z.number().int().min(0).max(10_000_000) }))
    .max(50)
    .optional(),
});

export async function POST(request) {
  const { body, response } = await parseBody(request, schema);
  if (response) return response;
  const auth = await getAuth();
  const ip = clientIp(request.headers);
  const who = auth.user ? `user:${auth.user.id}` : `ip:${ip || "unknown"}`;
  if (await rateLimited(`promo:${who}`, 20, 60)) return tooMany();

  let lines = body.lines?.length ? body.lines.map((l) => ({ slug: l.slug, lineKop: l.kop })) : null;
  let goodsKop = lines ? lines.reduce((s, l) => s + l.lineKop, 0) : Math.round((body.subtotal || 0) * 100);
  let source = "subtotal";
  let products = [];
  if (auth.user && auth.activeRole === "client") {
    const cart = await loadCart({ db: auth.supabase, userId: auth.user.id }).catch(() => null);
    if (cart?.items.length) {
      lines = cart.items.filter((i) => i.valid).map((i) => ({ slug: i.product?.slug, lineKop: i.lineTotalKop }));
      goodsKop = cart.goodsKop;
      source = "cart";
      products = cart.catalog?.products || [];
    }
  }
  if (!products.length) products = (await loadCatalog().catch(() => null))?.products || [];

  const { promo, result } = await checkPromoForCart(body.code, {
    lines: lines || undefined,
    goodsKop,
    // Личный код и «на клиента» проверяются только для вошедшего клиента; гостю — «войдите»
    userId: auth.user && auth.activeRole === "client" ? auth.user.id : null,
    products,
  });
  const code = body.code.trim().toUpperCase();
  await writeAudit({
    userId: auth.user?.id || null,
    role: auth.activeRole,
    action: "promo.validate",
    objectType: "promo",
    objectId: code.slice(0, 30),
    result: result.ok ? "success" : "denied",
    email: auth.user?.email,
    details: { reason: result.reason || null, source },
    ip,
  });
  // Неподходящий код — обычный ответ 200 с valid: false (не ошибка запроса): консоль браузера остаётся чистой
  if (!result.ok) {
    return json({
      ok: true,
      valid: false,
      code: `promo_${result.reason || "invalid"}`,
      reason: result.reason,
      message: result.message,
      ...(result.minTotalKop ? { minTotalKop: result.minTotalKop } : {}),
    });
  }
  return json({
    ok: true,
    valid: true,
    message: result.message,
    // Условия кода — чтобы экран сразу пересчитывал скидку при изменении корзины (заказ всё равно пересчитает сервер)
    promo: publicPromo(promo),
    goodsKop,
    eligibleKop: result.eligibleKop,
    discountKop: result.discountKop,
    discount: result.discountKop / 100,
    discountText: formatByn(result.discountKop),
    freeDelivery: result.freeDelivery,
    source,
  });
}
