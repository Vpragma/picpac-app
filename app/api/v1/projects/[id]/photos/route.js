// POST /api/v1/projects/{id}/photos { path, edits?, quality?, nsfw? } — зафиксировать загруженное фото.
// Сервер сам читает первые байты файла из хранилища: это должен быть JPEG или PNG, до 25 МБ.
// Размеры кадра берём из файла, а не со слов клиента. Чужой путь или подделка — отказ и удаление файла.
import { sniffImage } from "@/lib/imageMeta";
import { badId, BUCKET, MAX_PHOTO_BYTES, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { getOwnProject, needsModeration, PHOTO_FIELDS, shapePhoto } from "@/lib/server/projects";

const score = z.number().min(0).max(1);
const schema = z.object({
  path: z.string().max(300),
  edits: z.record(z.string(), z.unknown()).optional(),
  quality: z.record(z.string(), z.unknown()).optional(),
  // Результат проверки цензуры на устройстве (nsfwjs): вероятности классов
  nsfw: z.object({ porn: score, hentai: score, sexy: score, neutral: score.optional(), drawing: score.optional() }).optional(),
});

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (badId(id)) return notFound("Проект");
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  if (JSON.stringify(body.edits || {}).length > 20_000 || JSON.stringify(body.quality || {}).length > 20_000) {
    return jsonError(400, "invalid_input", "Слишком много данных о правках фото.");
  }

  const project = await getOwnProject(ctx, id);
  if (!project) {
    await ctx.audit("photo.add", "project", id, "denied", { reason: "not_found_or_foreign" });
    return notFound("Проект");
  }
  // Путь выдаёт только сервер: {мой id}/{этот проект}/{uuid}.jpg|png
  const pattern = new RegExp(`^${ctx.userId}/${id}/[0-9a-f-]{36}\\.(jpg|png)$`);
  if (!pattern.test(body.path)) {
    await ctx.audit("photo.add", "project", id, "denied", { reason: "foreign_path" });
    return jsonError(400, "invalid_path", "Неверный путь к фото. Загрузите фото заново.");
  }

  // Первые 512 КБ файла: тип и размеры кадра
  const { data: signed, error: e1 } = await ctx.admin.storage.from(BUCKET).createSignedUrl(body.path, 60);
  if (e1) return jsonError(404, "upload_missing", "Фото ещё не загрузилось. Попробуйте загрузить его заново.");
  let head;
  let total = 0;
  try {
    const res = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-524287" } });
    if (!res.ok && res.status !== 206) throw new Error("HTTP " + res.status);
    head = new Uint8Array(await res.arrayBuffer());
    const range = res.headers.get("content-range");
    total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length") || head.length);
  } catch (e) {
    console.error(e?.message);
    return serverError("storage_unavailable", "Не получилось прочитать фото из хранилища. Попробуйте ещё раз.");
  }
  const meta = sniffImage(head);
  if (!meta || !meta.width || total > MAX_PHOTO_BYTES) {
    await ctx.admin.storage.from(BUCKET).remove([body.path]);
    await ctx.audit("photo.add", "project", id, "denied", { reason: meta ? "too_big" : "not_image", bytes: total });
    return jsonError(
      400,
      meta ? "file_too_big" : "unsupported_format",
      meta ? "Файл больше 25 МБ. Уменьшите фото или выберите другое." : "Это не JPEG и не PNG. Мы печатаем только фото в этих форматах.",
    );
  }

  const { data: last } = await ctx.db
    .from("project_photos")
    .select("position")
    .eq("project_id", id)
    .eq("user_id", ctx.userId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const flag = needsModeration(body.nsfw);
  const { data, error } = await ctx.admin
    .from("project_photos")
    .insert({
      project_id: id,
      user_id: ctx.userId,
      storage_path: body.path,
      mime: meta.mime,
      bytes: total,
      width: meta.width,
      height: meta.height,
      position: (last?.position ?? -1) + 1,
      edits: body.edits || {},
      quality: body.quality || {},
      nsfw: body.nsfw || null,
      moderation_flag: flag,
    })
    .select(PHOTO_FIELDS)
    .single();
  if (error) {
    if (error.code === "23505") return jsonError(409, "already_added", "Это фото уже добавлено в проект.");
    await ctx.audit("photo.add", "project", id, "error");
    return serverError();
  }
  await ctx.admin.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId);
  await ctx.audit("photo.add", "photo", data.id, "success", { project: id, mime: meta.mime, bytes: total, width: meta.width, height: meta.height, moderation_flag: flag });
  return json({ ok: true, photo: shapePhoto(data) }, 201);
}
