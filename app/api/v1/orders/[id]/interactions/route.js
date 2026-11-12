// POST /api/v1/orders/{id}/interactions { topic, kind?, message } — обращение в поддержку по моему заказу.
// kind: support (вопрос) или reprint (перепечатка). Срок ответа (SLA) — 24 часа. Бот сразу подтверждает получение.
import { notFound, parseBody, rateLimited, requireUser, serverError, tooMany, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { getOwnOrder, shapeInteraction } from "@/lib/server/orders";

const schema = z.strictObject({
  topic: z.string().trim().min(1, "Выберите тему обращения.").max(120, "Тема — до 120 символов."),
  kind: z.enum(["support", "reprint"]).default("support"),
  message: z.string().trim().min(1, "Напишите, что случилось.").max(2000, "Сообщение — до 2000 символов."),
});

const SLA_HOURS = 24;

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  const order = await getOwnOrder(ctx, id, "id, number");
  if (!order) {
    await ctx.audit("interaction.create", "order", String(id).slice(0, 60), "denied", { reason: "not_found_or_foreign" });
    return notFound("Заказ");
  }
  if (await rateLimited(`interaction:${ctx.userId}`, 20, 3600)) return tooMany(3600);

  const sla = new Date(Date.now() + SLA_HOURS * 3600_000);
  const { data: it, error } = await ctx.admin
    .from("interactions")
    .insert({ order_id: order.id, user_id: ctx.userId, topic: body.topic, kind: body.kind, status: "open", sla_due: sla.toISOString() })
    .select("*")
    .single();
  if (error) {
    await ctx.audit("interaction.create", "interaction", null, "error", { order: order.number });
    return serverError();
  }
  const slaText = sla.toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const { data: messages, error: e2 } = await ctx.admin
    .from("interaction_messages")
    .insert([
      { interaction_id: it.id, author_kind: "client", author_id: ctx.userId, body: body.message },
      { interaction_id: it.id, author_kind: "bot", body: `Спасибо! Обращение по заказу ${order.number} получено. Оператор ответит до ${slaText}.` },
    ])
    .select("id, author_kind, body, created_at");
  if (e2) return serverError();
  await ctx.audit("interaction.create", "interaction", it.id, "success", { order: order.number, kind: body.kind });
  return json({ ok: true, interaction: shapeInteraction(it), messages: messages.map(shapeMessage) }, 201);
}

function shapeMessage(m) {
  return { id: m.id, author: m.author_kind, body: m.body, createdAt: m.created_at };
}
