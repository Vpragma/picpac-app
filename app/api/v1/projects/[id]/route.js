// /api/v1/projects/{id} — один мой проект.
// GET — проект с фото; PATCH { version, title?, options?, status? } — изменить (version защищает от затирания:
// если проект уже изменили с другого устройства — 409); DELETE — удалить проект и его фото.
import { badId, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { findProduct, loadCatalog, normalizeOptions } from "@/lib/server/catalog";
import { json, jsonError, sameOrigin } from "@/lib/server/http";
import { getOwnProject, listPhotos, optionsSchema, PROJECT_FIELDS, removeFiles, shapeProject } from "@/lib/server/projects";

const patchSchema = z.object({
  version: z.number({ error: "Нужна версия проекта: обновите страницу." }).int().min(1),
  title: z.string().trim().max(100, "Название — до 100 символов.").optional(),
  options: optionsSchema.optional(),
  status: z.enum(["draft", "in_cart"], { error: "Статус — черновик или в корзине." }).optional(),
});

export async function GET(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (badId(id)) return notFound("Проект");
  try {
    const project = await getOwnProject(ctx, id);
    if (!project) return notFound("Проект");
    return json({ ok: true, project: shapeProject(project, await listPhotos(ctx, id)) });
  } catch {
    return serverError();
  }
}

export async function PATCH(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (badId(id)) return notFound("Проект");
  const { body, response: bad } = await parseBody(request, patchSchema);
  if (bad) return bad;

  const current = await getOwnProject(ctx, id);
  if (!current) {
    await ctx.audit("project.update", "project", id, "denied", { reason: "not_found_or_foreign" });
    return notFound("Проект");
  }
  if (current.status === "ordered") return jsonError(409, "project_ordered", "Этот проект уже в заказе — его нельзя менять. Создайте копию.");

  const patch = { version: body.version + 1, updated_at: new Date().toISOString() };
  if (body.title !== undefined) patch.title = body.title;
  if (body.status !== undefined) patch.status = body.status;
  if (body.options !== undefined) {
    const product = findProduct(await loadCatalog(), current.product_slug);
    const { options, error } = normalizeOptions(product, { ...current.options, ...body.options });
    if (error) return jsonError(400, "invalid_input", error, { fields: { options: error } });
    patch.options = options;
  }

  // Меняем, только если версия совпала: иначе проект уже изменили на другом устройстве
  const { data, error } = await ctx.admin
    .from("projects")
    .update(patch)
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .eq("version", body.version)
    .select(PROJECT_FIELDS)
    .maybeSingle();
  if (error) return serverError();
  if (!data) {
    await ctx.audit("project.update", "project", id, "denied", { reason: "version_conflict", sent: body.version, actual: current.version });
    return jsonError(409, "version_conflict", "Проект изменили на другом устройстве. Обновите страницу, чтобы не потерять изменения.", {
      currentVersion: current.version,
    });
  }
  await ctx.audit("project.update", "project", id, "success", { version: data.version, fields: Object.keys(patch).filter((k) => k !== "version" && k !== "updated_at") });
  return json({ ok: true, project: shapeProject(data) });
}

export async function DELETE(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  if (badId(id)) return notFound("Проект");
  const project = await getOwnProject(ctx, id);
  if (!project) {
    await ctx.audit("project.delete", "project", id, "denied", { reason: "not_found_or_foreign" });
    return notFound("Проект");
  }
  if (project.status === "ordered") return jsonError(409, "project_ordered", "Проект уже в заказе. Фото заказа можно удалить в профиле: «Удалить мои фото».");
  try {
    const photos = await listPhotos(ctx, id);
    await removeFiles(ctx.admin, photos.flatMap((p) => [p.storage_path, p.print_path]));
    const { error } = await ctx.admin.from("projects").delete().eq("id", id).eq("user_id", ctx.userId);
    if (error) throw new Error(error.message);
    await ctx.audit("project.delete", "project", id, "success", { photos: photos.length });
    return json({ ok: true, deletedPhotos: photos.length });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("project.delete", "project", id, "error");
    return serverError();
  }
}
