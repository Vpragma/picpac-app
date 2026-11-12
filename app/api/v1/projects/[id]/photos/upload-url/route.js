// POST /api/v1/projects/{id}/photos/upload-url { mime, bytes } — ссылка для загрузки одного фото в хранилище.
// Проверяем тип (JPEG/PNG) и размер (до 25 МБ) заранее; после загрузки файл проверяется ещё раз по первым байтам
// (POST /api/v1/projects/{id}/photos). Путь в хранилище: {user_id}/{project_id}/{uuid}.jpg — имя файла клиента не используется.
import { badId, BUCKET, MAX_PHOTO_BYTES, notFound, parseBody, PHOTO_MIMES, rateLimited, requireUser, serverError, tooMany, z } from "@/lib/server/api";
import { findProduct, loadCatalog } from "@/lib/server/catalog";
import { json, jsonError } from "@/lib/server/http";
import { getOwnProject } from "@/lib/server/projects";

const schema = z.strictObject({
  mime: z.enum(PHOTO_MIMES, { error: "Подходят только JPEG и PNG." }),
  bytes: z
    .number({ error: "Укажите размер файла в байтах." })
    .int()
    .min(1, "Файл пустой.")
    .max(MAX_PHOTO_BYTES, "Файл больше 25 МБ. Уменьшите фото или выберите другое."),
  name: z.string().max(200).optional(),
});

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (badId(id)) return notFound("Проект");
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) {
    await ctx.audit("photo.upload_url", "project", id, "denied", { reason: "invalid_input" });
    return bad;
  }
  if (await rateLimited(`upload:${ctx.userId}`, 240, 60)) return tooMany();

  const project = await getOwnProject(ctx, id);
  if (!project) {
    await ctx.audit("photo.upload_url", "project", id, "denied", { reason: "not_found_or_foreign" });
    return notFound("Проект");
  }
  if (project.status === "ordered") return jsonError(409, "project_ordered", "Проект уже в заказе — новые фото добавить нельзя.");

  const product = findProduct(await loadCatalog(), project.product_slug);
  const { count } = await ctx.db.from("project_photos").select("id", { count: "exact", head: true }).eq("project_id", id).eq("user_id", ctx.userId);
  if ((count || 0) >= (product?.photos.max || 500)) {
    return jsonError(409, "too_many_photos", `В этот проект помещается до ${product?.photos.max || 500} фото.`);
  }

  const ext = body.mime === "image/png" ? "png" : "jpg";
  const path = `${ctx.userId}/${id}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await ctx.admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    console.error(error.message);
    await ctx.audit("photo.upload_url", "project", id, "error");
    return serverError("storage_unavailable", "Хранилище фото не отвечает. Попробуйте ещё раз через минуту.");
  }
  await ctx.audit("photo.upload_url", "project", id, "success", { mime: body.mime, bytes: body.bytes });
  return json({
    ok: true,
    upload: {
      path,
      token: data.token,
      url: data.signedUrl,
      method: "PUT",
      headers: { "content-type": body.mime, "x-upsert": "false" },
      expiresIn: 7200,
    },
  });
}
