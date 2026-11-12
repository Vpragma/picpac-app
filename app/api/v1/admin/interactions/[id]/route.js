// /api/v1/admin/interactions/{id} — обращение клиента для оператора (роль «админ»).
// GET — обращение, заказ (данные клиента замаскированы, SEC-14) и переписка.
// POST { body, close? } — ответ оператора: клиент увидит его в заказе и получит уведомление «Ответ поддержки».
import { badId, limitWrite, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { maskClient } from "@/lib/mask";
import { shapeInteraction, STATUS_LABELS } from "@/lib/server/orders";

const schema = z.strictObject({
  body: z.string().trim().min(2, "Напишите ответ — от 2 символов.").max(2000, "Ответ — до 2000 символов."),
  close: z.boolean().optional(),
});

const shapeMessage = (m) => ({ id: m.id, author: m.author_kind, body: m.body, createdAt: m.created_at });

async function load(ctx, id) {
  if (badId(id)) return null;
  const { data } = await ctx.admin
    .from("interactions")
    .select("*, orders(id, number, status, recipient, delivery_address, is_synthetic)")
    .eq("id", id)
    .maybeSingle();
  return data;
}

export async function GET(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const it = await load(ctx, id);
  if (!it) return notFound("Обращение");
  const { data, error } = await ctx.admin.from("interaction_messages").select("id, author_kind, body, created_at").eq("interaction_id", id).order("created_at");
  if (error) return serverError();
  const o = it.orders || {};
  return json({
    ok: true,
    interaction: shapeInteraction(it),
    order: { id: o.id, number: o.number, status: o.status, statusLabel: STATUS_LABELS[o.status], client: maskClient(o, "admin") },
    messages: data.map(shapeMessage),
  });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  const limited = await limitWrite("operator-reply", ctx.userId, 60);
  if (limited) return limited;
  const it = await load(ctx, id);
  if (!it) return notFound("Обращение");
  if (it.status === "closed") return jsonError(409, "interaction_closed", "Обращение закрыто — ответить в нём нельзя.");
  const { data, error } = await ctx.admin
    .from("interaction_messages")
    .insert({ interaction_id: id, author_kind: "operator", author_id: ctx.userId, body: body.body })
    .select("id, author_kind, body, created_at")
    .single();
  if (error) {
    await ctx.audit("interaction.reply", "interaction", id, "error");
    return serverError();
  }
  const status = body.close ? "closed" : "answered";
  await ctx.admin.from("interactions").update({ status, assignee_id: ctx.userId, updated_at: new Date().toISOString() }).eq("id", id);
  await ctx.audit("interaction.reply", "interaction", id, "success", { order: it.orders?.number, close: !!body.close });
  return json({ ok: true, message: shapeMessage(data), status }, 201);
}
