// POST /api/v1/projects/{id}/photos { path, edits?, quality?, nsfw? } — зафиксировать загруженное фото.
// Сервер сам читает первые байты файла из хранилища: это должен быть JPEG или PNG, до 25 МБ.
// Размеры кадра берём из файла, а не со слов клиента. Чужой путь или подделка — отказ и удаление файла.
// nsfw — оценки проверки на устройстве (N4: v 2, или старые nsfwjs): флаг «проверит модератор» сразу;
// после ответа сервер сам проверяет файл своими моделями (after → lib/server/moderationCheck.js).
import { after } from "next/server";
import { sniffImage, tooManyPixels } from "@/lib/imageMeta";
import { badId, BUCKET, limitWrite, MAX_PHOTO_BYTES, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { deviceScoresSchema, getOwnProject, needsModeration, PHOTO_FIELDS, shapePhoto } from "@/lib/server/projects";
import { checkPhotoById } from "@/lib/server/moderationCheck";

// Фоновая проверка фото на сервере (модели загружаются один раз на экземпляр) — после ответа клиенту
export const maxDuration = 120;

const schema = z.strictObject({
  path: z.string().max(300),
  edits: z.record(z.string(), z.unknown()).optional(),
  quality: z.record(z.string(), z.unknown()).optional(),
  // Оценки проверки на устройстве (N4: классификатор обнажённости и CLIP; старые клиенты — nsfwjs)
  nsfw: deviceScoresSchema.optional(),
});

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limited = await limitWrite("photo-add", ctx.userId, 240, 60);
  if (limited) return limited;
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
  // Путь уже проверен: это файл этого пользователя в этом проекте — его можно убрать
  if (project.status === "ordered") {
    await ctx.admin.storage.from(BUCKET).remove([body.path]).catch(() => {});
    await ctx.audit("photo.add", "project", id, "denied", { reason: "project_ordered" });
    return jsonError(409, "project_ordered", "Проект уже в заказе — новые фото добавить нельзя. Создайте новый проект.");
  }

  // Начало файла: тип и размеры кадра. Сначала 512 КБ; если у JPEG до блока размеров много служебных данных
  // (EXIF, превью, данные камеры), дочитываем до 6 МБ.
  const { data: signed, error: e1 } = await ctx.admin.storage.from(BUCKET).createSignedUrl(body.path, 60);
  if (e1) return jsonError(404, "upload_missing", "Фото ещё не загрузилось. Попробуйте загрузить его заново.");
  let meta = null;
  let total = 0;
  try {
    for (const end of [524287, 6 * 1024 * 1024 - 1]) {
      const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${end}` } });
      if (!res.ok && res.status !== 206) throw new Error("HTTP " + res.status);
      const head = new Uint8Array(await res.arrayBuffer());
      const range = res.headers.get("content-range");
      total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length") || head.length);
      meta = sniffImage(head);
      if (!meta || meta.width || head.length >= total) break;
    }
  } catch (e) {
    console.error(e?.message);
    return serverError("storage_unavailable", "Не получилось прочитать фото из хранилища. Попробуйте ещё раз.");
  }
  const problem = !meta
    ? ["unsupported_format", "Это не JPEG и не PNG. Мы печатаем только фото в этих форматах."]
    : total > MAX_PHOTO_BYTES
      ? ["file_too_big", "Файл больше 25 МБ. Уменьшите фото или выберите другое."]
      : !meta.width
        ? ["unreadable_image", "Не получилось прочитать размеры фото. Откройте его в галерее телефона, сохраните копию и загрузите её."]
        : tooManyPixels(meta)
          ? ["too_many_pixels", "Фото больше 100 мегапикселей — такое мы не обработаем. Уменьшите его (например, до 12 000 точек по длинной стороне) и загрузите снова."]
          : null;
  if (problem) {
    await ctx.admin.storage.from(BUCKET).remove([body.path]);
    await ctx.audit("photo.add", "project", id, "denied", { reason: problem[0], bytes: total, ...(meta?.width ? { width: meta.width, height: meta.height } : {}) });
    return jsonError(400, problem[0], problem[1]);
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
    if (error.message === "project_ordered") {
      // Заказ оформили, пока фото загружалось: страж в базе не пустил фото в заказанный проект
      await ctx.admin.storage.from(BUCKET).remove([body.path]).catch(() => {});
      await ctx.audit("photo.add", "project", id, "denied", { reason: "project_ordered" });
      return jsonError(409, "project_ordered", "Проект уже в заказе — новые фото добавить нельзя. Создайте новый проект.");
    }
    await ctx.audit("photo.add", "project", id, "error");
    return serverError();
  }
  await ctx.admin.from("projects").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", ctx.userId);
  await ctx.audit("photo.add", "photo", data.id, "success", { project: id, mime: meta.mime, bytes: total, width: meta.width, height: meta.height, moderation_flag: flag });
  after(() => checkPhotoById(ctx, data.id).catch((e) => console.error("Фоновая проверка фото:", e?.message)));
  return json({ ok: true, photo: shapePhoto(data) }, 201);
}
