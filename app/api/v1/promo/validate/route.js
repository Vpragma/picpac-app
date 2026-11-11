// POST /api/v1/promo/validate { code, subtotal? } — проверить промокод.
// Сумма: для вошедшего клиента — его корзина на сервере; для гостя — subtotal (BYN), только для предпросмотра:
// при оформлении заказа сервер всё равно пересчитает скидку сам. Лимит: 20 проверок в минуту.
import { applyPromo, formatByn } from "@/lib/pricing";
import { clientIp, writeAudit } from "@/lib/server/audit";
import { parseBody, rateLimited, tooMany, z } from "@/lib/server/api";
import { findPromo } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { loadCart } from "@/lib/server/projects";
import { getAuth } from "@/lib/server/session";

const schema = z.object({
  code: z.string().trim().min(1, "Введите промокод.").max(30, "Промокод — до 30 символов."),
  subtotal: z.number().min(0).max(100000).optional(),
});

const CODES = { not_found: "promo_not_found", not_started: "promo_not_started", expired: "promo_expired", min_total: "promo_min_total" };

export async function POST(request) {
  const { body, response } = await parseBody(request, schema);
  if (response) return response;
  const auth = await getAuth();
  const ip = clientIp(request.headers);
  const who = auth.user ? `user:${auth.user.id}` : `ip:${ip || "unknown"}`;
  if (await rateLimited(`promo:${who}`, 20, 60)) return tooMany();

  let goodsKop = Math.round((body.subtotal || 0) * 100);
  let source = "subtotal";
  if (auth.user && auth.activeRole === "client") {
    const cart = await loadCart({ db: auth.supabase, userId: auth.user.id }).catch(() => null);
    if (cart?.items.length) {
      goodsKop = cart.goodsKop;
      source = "cart";
    }
  }

  const promo = await findPromo(body.code);
  const result = applyPromo(promo, goodsKop);
  const code = body.code.toUpperCase();
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
  if (!result.ok) return jsonError(422, CODES[result.reason] || "promo_invalid", result.message);
  return json({
    ok: true,
    message: result.message,
    // Условия кода — чтобы экран сразу пересчитывал скидку при изменении корзины (заказ всё равно пересчитает сервер)
    promo: {
      code: result.code,
      kind: result.kind,
      label: result.label,
      value: promo.value,
      minTotalKop: promo.minTotalKop || 0,
      validFrom: promo.validFrom,
      validTo: promo.validTo,
      active: true,
    },
    goodsKop,
    discountKop: result.discountKop,
    discount: result.discountKop / 100,
    discountText: formatByn(result.discountKop),
    freeDelivery: result.freeDelivery,
    source,
  });
}
