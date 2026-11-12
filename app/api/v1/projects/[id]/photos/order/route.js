// PATCH /api/v1/projects/{id}/photos/order { order: [photoId, ...] } — новый порядок фото в проекте.
// Список должен содержать ровно все фото проекта, без повторов.
import { badId, limitWrite, notFound, parseBody, requireUser, serverError, uuid, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { getOwnProject, listPhotos } from "@/lib/server/projects";

const schema = z.strictObject({ order: z.array(uuid).min(1, "Список фото пуст.").max(500) });

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limited = await limitWrite("photo-order", ctx.userId, 120, 60);
  if (limited) return limited;
  if (badId(id)) return notFound("Проект");
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;

  const project = await getOwnProject(ctx, id);
  if (!project) {
    await ctx.audit("photo.reorder", "project", id, "denied", { reason: "not_found_or_foreign" });
    return notFound("Проект");
  }
  if (project.status === "ordered") {
    await ctx.audit("photo.reorder", "project", id, "denied", { reason: "project_ordered" });
    return jsonError(409, "project_ordered", "Проект уже в заказе — порядок фото менять нельзя.");
  }
  const photos = await listPhotos(ctx, id);
  const have = new Set(photos.map((p) => p.id));
  const sent = new Set(body.order);
  if (sent.size !== body.order.length || sent.size !== have.size || body.order.some((x) => !have.has(x))) {
    return jsonError(400, "invalid_input", "Порядок фото устарел: список не совпадает с фото проекта. Обновите страницу.");
  }
  const { data, error } = await ctx.admin.rpc("reorder_photos", { _project: id, _ids: body.order });
  if (error?.message === "project_ordered") return jsonError(409, "project_ordered", "Проект уже в заказе — порядок фото менять нельзя.");
  if (error) {
    await ctx.audit("photo.reorder", "project", id, "error");
    return serverError();
  }
  await ctx.admin.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId);
  await ctx.audit("photo.reorder", "project", id, "success", { count: data });
  return json({ ok: true, count: data });
}
