// /api/v1/interactions/{id}/messages — переписка по моему обращению.
// GET — сообщения; POST { body } — новое сообщение клиента. Чужое обращение — 404.
import { badId, notFound, parseBody, rateLimited, requireUser, serverError, tooMany, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { shapeInteraction } from "@/lib/server/orders";

const schema = z.object({ body: z.string().trim().min(1, "Напишите сообщение.").max(2000, "Сообщение — до 2000 символов.") });

async function ownInteraction(ctx, id) {
  if (badId(id)) return null;
  const { data } = await ctx.db.from("interactions").select("*").eq("id", id).eq("user_id", ctx.userId).maybeSingle();
  return data;
}

const shapeMessage = (m) => ({ id: m.id, author: m.author_kind, body: m.body, createdAt: m.created_at });

export async function GET(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const it = await ownInteraction(ctx, id);
  if (!it) {
    await ctx.audit("interaction.view", "interaction", String(id).slice(0, 60), "denied", { reason: "not_found_or_foreign" });
    return notFound("Обращение");
  }
  const { data, error } = await ctx.db.from("interaction_messages").select("id, author_kind, body, created_at").eq("interaction_id", id).order("created_at");
  if (error) return serverError();
  return json({ ok: true, interaction: shapeInteraction(it), messages: data.map(shapeMessage) });
}

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  const it = await ownInteraction(ctx, id);
  if (!it) {
    await ctx.audit("interaction.message", "interaction", String(id).slice(0, 60), "denied", { reason: "not_found_or_foreign" });
    return notFound("Обращение");
  }
  if (it.status === "closed") return jsonError(409, "interaction_closed", "Обращение закрыто. Создайте новое на странице заказа.");
  if (await rateLimited(`message:${ctx.userId}`, 30, 600)) return tooMany(600);

  const { data, error } = await ctx.admin
    .from("interaction_messages")
    .insert({ interaction_id: id, author_kind: "client", author_id: ctx.userId, body: body.body })
    .select("id, author_kind, body, created_at")
    .single();
  if (error) {
    await ctx.audit("interaction.message", "interaction", id, "error");
    return serverError();
  }
  await ctx.admin.from("interactions").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", id);
  await ctx.audit("interaction.message", "interaction", id, "success");
  return json({ ok: true, message: shapeMessage(data) }, 201);
}
