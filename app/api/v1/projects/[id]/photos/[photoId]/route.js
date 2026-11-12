// DELETE /api/v1/projects/{id}/photos/{photoId} — удалить фото из проекта и файл из хранилища.
import { badId, BUCKET, notFound, requireUser, serverError } from "@/lib/server/api";
import { json, jsonError, sameOrigin } from "@/lib/server/http";
import { getOwnProject } from "@/lib/server/projects";

export async function DELETE(request, { params }) {
  const { id, photoId } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  if (badId(id) || badId(photoId)) return notFound("Фото");

  const project = await getOwnProject(ctx, id);
  const { data: photo } = project
    ? await ctx.db.from("project_photos").select("id, storage_path, print_path").eq("id", photoId).eq("project_id", id).eq("user_id", ctx.userId).maybeSingle()
    : { data: null };
  if (!photo) {
    await ctx.audit("photo.delete", "photo", photoId, "denied", { reason: "not_found_or_foreign" });
    return notFound("Фото");
  }
  if (project.status === "ordered") return jsonError(409, "project_ordered", "Фото уже в заказе. Удалить его можно в профиле: «Удалить мои фото».");

  const { error: e1 } = await ctx.admin.storage.from(BUCKET).remove([photo.storage_path, photo.print_path].filter(Boolean));
  const { error: e2 } = await ctx.admin.from("project_photos").delete().eq("id", photoId).eq("user_id", ctx.userId);
  if (e1 || e2) {
    await ctx.audit("photo.delete", "photo", photoId, "error");
    return serverError();
  }
  await ctx.audit("photo.delete", "photo", photoId, "success", { project: id });
  return json({ ok: true });
}
