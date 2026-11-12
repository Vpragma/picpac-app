// /api/v1/admin/push-demo — «Демо пушей» для защиты (D9). Только роль admin: модератор и клиент получают 403.
// GET ?email= — тестовые клиенты, их устройства и последние демо-отправки из журнала.
// POST { action: "test" | "cart" | "advance", email } — пуш по шаблону (произвольного текста нет), не чаще раза в 10 с.
// Каждое действие — в журнал аудита: шаблон, сколько устройств, ответы push-сервиса (коды), без адресов подписок.
import { randomUUID } from "node:crypto";
import { parseBody, rateLimited, requireUser, serverError, z } from "@/lib/server/api";
import { loadCatalog } from "@/lib/server/catalog";
import { applyEvent } from "@/lib/server/erp";
import { json, jsonError } from "@/lib/server/http";
import { pushToUser } from "@/lib/server/push";
import { DEMO_ACTIONS, demoPushText, NEXT_STATUS, pushResultText } from "@/lib/notifyRules";

// Выбор — только тестовые аккаунты: демо-клиенты и временные e2e-…@example.com из автотестов
const DEMO_CLIENTS = ["client@example.com", "admin@example.com"];
const testEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(120)
  .refine((e) => DEMO_CLIENTS.includes(e) || /^e2e-[a-z0-9-]{1,60}@example\.com$/.test(e), "Можно выбрать только тестовый аккаунт.");
const schema = z.strictObject({ action: z.enum(DEMO_ACTIONS, { error: "Неизвестное действие." }), email: testEmail.default("client@example.com") });

async function findUser(admin, email) {
  for (let page = 1; page <= 5; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = (data?.users || []).find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if ((data?.users || []).length < 200) return null;
  }
  return null;
}

async function devicesOf(admin, userId) {
  const { data } = await admin.from("push_subscriptions").select("id, device, created_at, last_ok_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(10);
  return (data || []).map((d) => ({ id: d.id, device: d.device || "устройство", createdAt: d.created_at, lastOkAt: d.last_ok_at }));
}

export async function GET(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const parsed = testEmail.safeParse(new URL(request.url).searchParams.get("email") || "client@example.com");
  if (!parsed.success) return jsonError(400, "validation_error", "Можно выбрать только тестовый аккаунт.");
  const user = await findUser(ctx.admin, parsed.data);
  const { data: log } = await ctx.admin
    .from("audit_log")
    .select("at, result, details")
    .eq("action", "admin.push_demo")
    .order("at", { ascending: false })
    .limit(10);
  return json({
    ok: true,
    clients: DEMO_CLIENTS,
    email: parsed.data,
    found: !!user,
    devices: user ? await devicesOf(ctx.admin, user.id) : [],
    log: (log || []).map((r) => ({ at: r.at, result: r.result, action: r.details?.action, email: r.details?.email, text: r.details?.text })),
  });
}

export async function POST(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  // Окна ограничителя выровнены по 10 с: два нажатия на стыке окон прошли бы оба — добиваем скользящими 10 с по журналу
  const since = new Date(Date.now() - 10_000).toISOString();
  const { count: recent } = await ctx.admin
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", "admin.push_demo")
    .eq("user_id", ctx.userId)
    .gte("at", since);
  if ((await rateLimited(`w:push-demo:${ctx.userId}`, 1, 10)) || recent > 0) {
    const res = jsonError(429, "rate_limited", "Не чаще одного пуша в 10 секунд. Подождите и нажмите снова.");
    res.headers.set("Retry-After", "10");
    return res;
  }
  const done = async (result, text, extra = {}) => {
    await ctx.audit("admin.push_demo", "user", body.email, result, { action: body.action, email: body.email, text, ...extra });
    return json({ ok: result === "success", action: body.action, text, ...extra });
  };
  try {
    const user = await findUser(ctx.admin, body.email);
    if (!user) return done("error", `Аккаунт ${body.email} не найден.`);

    let message;
    if (body.action === "test") message = demoPushText("test");
    else if (body.action === "cart") {
      // Текст — из настоящей корзины клиента (без порога 5 минут и тихих часов: только эта кнопка)
      const { data: items } = await ctx.admin
        .from("cart_items")
        .select("updated_at, projects(title, product_slug, status, options)")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(20);
      const live = (items || []).filter((x) => x.projects && x.projects.status !== "ordered");
      if (!live.length) return done("denied", "Корзина клиента пуста — добавьте книгу в корзину на телефоне.");
      const cat = await loadCatalog().catch(() => null);
      const bySlug = Object.fromEntries((cat?.products || []).map((p) => [p.slug, p]));
      // «Фотокнига Classic 20×20»: вид товара, название из каталога и формат проекта (название книги от клиента в пуш не попадает)
      const label = (pr) => {
        const p = bySlug[pr.product_slug];
        const name = p?.name || "Фотокнига";
        const kind = p?.kind === "book" && !/^фото/i.test(name) ? "Фотокнига " : "";
        const size = /^\d{1,3}x\d{1,3}$/.test(pr.options?.size || "") ? " " + pr.options.size.replace("x", "×") : "";
        return kind + name + size;
      };
      message = demoPushText("cart", { products: live.map((x) => label(x.projects)) });
    } else {
      // Последний заказ клиента → следующий статус с причиной «Демонстрация» (та же функция, что у ERP и админки)
      const { data: order } = await ctx.admin.from("orders").select("id, number, status").eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (!order) return done("denied", "У клиента нет заказов — оформите заказ на телефоне.");
      const next = NEXT_STATUS[order.status];
      if (!next) return done("denied", `Заказ №${order.number} уже завершён — двигать некуда.`);
      const r = await applyEvent(ctx.admin, {
        eventId: `demo:${randomUUID()}`,
        orderId: order.id,
        type: "manual_status",
        source: "admin",
        actor: ctx.userId,
        reason: "Демонстрация",
        payload: { status: next },
      });
      if (r.error || r.result !== "applied") return done("denied", `Статус заказа №${order.number} не изменился (${r.code || "ошибка"}).`);
      // Ровно один пуш на событие: строки центра уведомлений этого заказа отмечаем отправленными сами
      await ctx.admin.from("notifications").update({ pushed_at: new Date().toISOString() }).eq("order_id", order.id).is("pushed_at", null);
      message = demoPushText("advance", { number: order.number, orderId: order.id, status: next });
    }

    const sent = await pushToUser(user.id, message, { urgency: "high", ttl: 600 });
    const text = pushResultText(sent.results, { noVapid: sent.skipped === "no_vapid" });
    return done(sent.sent > 0 ? "success" : "error", text, {
      title: message.title,
      body: message.body,
      devices: sent.results.length,
      accepted: sent.sent,
      codes: sent.results.map((x) => x.status),
      removed: sent.removed,
    });
  } catch (e) {
    console.error("push-demo:", e?.message);
    return serverError();
  }
}
