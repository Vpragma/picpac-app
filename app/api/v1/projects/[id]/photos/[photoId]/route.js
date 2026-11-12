// DELETE /api/v1/projects/{id}/photos/{photoId} — удалить фото из проекта и файл из хранилища.
// PATCH { nsfw } — оценки проверки на устройстве (N4 v 2 или старые nsfwjs) для уже загруженного фото, например
// досланные после загрузки. Флаг модерации только ставится: снять его оценками с устройства нельзя (флаг сервера
// или прежний флаг остаются — решает модератор).
import { badId, BUCKET, limitWrite, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json, jsonError, sameOrigin } from "@/lib/server/http";
import { deviceScoresSchema, getOwnProject, needsModeration, PHOTO_FIELDS, shapePhoto } from "@/lib/server/projects";

const patchSchema = z.strictObject({ nsfw: deviceScoresSchema });

export async function PATCH(request, { params }) {
  const { id, photoId } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, patchSchema);
  if (bad) return bad;
  const limited = await limitWrite("photo-nsfw", ctx.userId, 240, 60);
  if (limited) return limited;
  if (badId(id) || badId(photoId)) return notFound("Фото");
  const project = await getOwnProject(ctx, id);
  if (!project) return notFound("Фото");
  if (project.status === "ordered") return jsonError(409, "project_ordered", "Фото уже в заказе — проверку меняет модератор.");
  const flag = needsModeration(body.nsfw);
  const { data, error } = await ctx.admin
    .from("project_photos")
    .update({ nsfw: body.nsfw, ...(flag ? { moderation_flag: true } : {}) })
    .eq("id", photoId)
    .eq("project_id", id)
    .eq("user_id", ctx.userId)
    .select(PHOTO_FIELDS)
    .maybeSingle();
  if (error) return serverError();
  if (!data) return notFound("Фото");
  await ctx.audit("photo.nsfw", "photo", photoId, "success", { project: id, moderation_flag: data.moderation_flag });
  return json({ ok: true, photo: shapePhoto(data) });
}

export async function DELETE(request, { params }) {
  const { id, photoId } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limited = await limitWrite("photo-delete", ctx.userId, 240, 60);
  if (limited) return limited;
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

  // Сначала строка, затем проверка: если проект успели заказать (гонка с POST /orders), файлы не трогаем —
  // их держит снимок заказа. Файлы удаляются только у незаказанного проекта.
  const { error: e2 } = await ctx.admin.from("project_photos").delete().eq("id", photoId).eq("user_id", ctx.userId);
  if (e2) {
    await ctx.audit("photo.delete", "photo", photoId, "error");
    return serverError();
  }
  const { data: after } = await ctx.admin.from("projects").select("status").eq("id", id).maybeSingle();
  if (after?.status === "ordered") {
    await ctx.audit("photo.delete", "photo", photoId, "denied", { reason: "ordered_during_delete", project: id });
    return jsonError(409, "project_ordered", "Фото уже в заказе. Удалить его можно в профиле: «Удалить мои фото».");
  }
  const { error: e1 } = await ctx.admin.storage.from(BUCKET).remove([photo.storage_path, photo.print_path].filter(Boolean));
  if (e1) {
    await ctx.audit("photo.delete", "photo", photoId, "error");
    return serverError();
  }
  await ctx.audit("photo.delete", "photo", photoId, "success", { project: id });
  return json({ ok: true });
}
