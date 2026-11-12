// Печатная версия фото (S03e): файл полного разрешения со всеми правками, собранный на устройстве.
// Оригинал не меняется и хранится отдельно; печатная версия лежит рядом: {user}/{project}/print/{photo}/{uuid}.jpg.
//   POST /api/v1/projects/{id}/photos/{photoId}/print { bytes } — ссылка для загрузки файла (JPEG, до 25 МБ);
//   PUT  /api/v1/projects/{id}/photos/{photoId}/print { path, edits } — зафиксировать: сервер сам читает начало файла
//        (JPEG, размеры кадра как у оригинала или ровно ×2 при «Резкости для печати»), записывает print_path и правки фото (edits.print = путь и размеры).
//        Снимок заказа (order_items.snapshot.photos[].edits) берёт правки отсюда — печать получает и правки, и файл.
//   PUT  { path: null } — правки сняли: печатаем оригинал; { path: null, edits } — файл не собрался, правки параметрами.
//   Правки фото — не больше PHOTO_EDITS_MAX (20 КБ, lib/photo/edits.js), иначе 400 edits_too_large и файл удаляется.
//   После сохранения в папке печатных версий фото остаётся один файл — прежние и брошенные удаляются.
import { after } from "next/server";
import { sniffImage } from "@/lib/imageMeta";
import { badId, BUCKET, MAX_PHOTO_BYTES, notFound, parseBody, rateLimited, requireUser, serverError, tooMany, z } from "@/lib/server/api";
import { json, jsonError, sameOrigin } from "@/lib/server/http";
import { PHOTO_EDITS_MAX, editsBytes } from "@/lib/photo/edits";
import { getOwnProject } from "@/lib/server/projects";
import { checkPhotoById } from "@/lib/server/moderationCheck";

// N4: новая печатная версия — сервер проверяет и её (в печать идёт она, а не оригинал)
export const maxDuration = 120;

const urlSchema = z.strictObject({
  bytes: z
    .number({ error: "Укажите размер файла в байтах." })
    .int()
    .min(1, "Файл пустой.")
    .max(MAX_PHOTO_BYTES, "Печатная версия больше 25 МБ."),
});
const saveSchema = z.strictObject({
  path: z.string().max(300).nullable(),
  edits: z.record(z.string(), z.unknown()).optional(),
});

async function load(ctx, id, photoId) {
  const project = await getOwnProject(ctx, id);
  if (!project) return {};
  const { data: photo } = await ctx.db
    .from("project_photos")
    .select("id, width, height, print_path")
    .eq("id", photoId)
    .eq("project_id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return { project, photo };
}

export async function POST(request, { params }) {
  const { id, photoId } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (badId(id) || badId(photoId)) return notFound("Фото");
  const { body, response: bad } = await parseBody(request, urlSchema);
  if (bad) return bad;
  if (await rateLimited(`print:${ctx.userId}`, 240, 60)) return tooMany();
  const { project, photo } = await load(ctx, id, photoId);
  if (!photo) {
    await ctx.audit("photo.print_url", "photo", photoId, "denied", { reason: "not_found_or_foreign" });
    return notFound("Фото");
  }
  if (project.status === "ordered") return jsonError(409, "project_ordered", "Проект уже в заказе — менять фото нельзя.");
  const path = `${ctx.userId}/${id}/print/${photoId}/${crypto.randomUUID()}.jpg`;
  const { data, error } = await ctx.admin.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    console.error(error.message);
    return serverError("storage_unavailable", "Хранилище фото не отвечает. Попробуйте ещё раз через минуту.");
  }
  await ctx.audit("photo.print_url", "photo", photoId, "success", { bytes: body.bytes });
  return json({
    ok: true,
    upload: { path, token: data.token, url: data.signedUrl, method: "PUT", headers: { "content-type": "image/jpeg", "x-upsert": "false" }, expiresIn: 7200 },
  });
}

export async function PUT(request, { params }) {
  const { id, photoId } = await params;
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  if (badId(id) || badId(photoId)) return notFound("Фото");
  const { body, response: bad } = await parseBody(request, saveSchema);
  if (bad) return bad;
  // Путь выдаёт только сервер: {мой id}/{этот проект}/print/{это фото}/{uuid}.jpg
  const pattern = new RegExp(`^${ctx.userId}/${id}/print/${photoId}/[0-9a-f-]{36}\\.jpg$`);
  // Правки фото не больше PHOTO_EDITS_MAX (тот же счёт у редактора и оформления заказа). Отказ — и уже загруженный
  // файл печатной версии удаляем сразу, чтобы в хранилище не оставалось файлов без ссылки
  if (editsBytes(body.edits) > PHOTO_EDITS_MAX) {
    if (typeof body.path === "string" && pattern.test(body.path)) await ctx.admin.storage.from(BUCKET).remove([body.path]).catch(() => {});
    await ctx.audit("photo.print", "photo", photoId, "denied", { reason: "edits_too_large", bytes: editsBytes(body.edits) });
    return jsonError(400, "edits_too_large", "На этом фото слишком много правок по выделению — их не сохранить. Уберите часть правок на шаге «Правки» («Отменить»).");
  }
  const { project, photo } = await load(ctx, id, photoId);
  if (!photo) {
    await ctx.audit("photo.print", "photo", photoId, "denied", { reason: "not_found_or_foreign" });
    return notFound("Фото");
  }
  if (project.status === "ordered") return jsonError(409, "project_ordered", "Проект уже в заказе — менять фото нельзя.");

  // Прежние печатные версии этого фото (и брошенные после сбоя связи) — удалить, оставить только keep
  const removeOld = async (keep) => {
    const dir = `${ctx.userId}/${id}/print/${photoId}`;
    const { data: list } = await ctx.admin.storage.from(BUCKET).list(dir, { limit: 100 }).catch(() => ({ data: null }));
    const paths = new Set((list || []).map((f) => `${dir}/${f.name}`));
    if (photo.print_path) paths.add(photo.print_path);
    paths.delete(keep);
    if (paths.size) await ctx.admin.storage.from(BUCKET).remove([...paths]).catch(() => {});
  };

  // Без файла: правки сняли — печатаем оригинал; или файл не собрался на устройстве — правки записываются
  // параметрами (печать применит их сама)
  if (body.path === null) {
    const edits = body.edits && Object.keys(body.edits).length ? body.edits : {};
    const { error } = await ctx.admin.from("project_photos").update({ print_path: null, edits }).eq("id", photoId).eq("user_id", ctx.userId);
    if (error) return serverError();
    await removeOld(null);
    await ctx.audit("photo.print", "photo", photoId, "success", { cleared: true, edits: Object.keys(edits).length > 0 });
    return json({ ok: true, print: null });
  }

  if (!pattern.test(body.path)) {
    await ctx.audit("photo.print", "photo", photoId, "denied", { reason: "foreign_path" });
    return jsonError(400, "invalid_path", "Неверный путь к печатной версии. Соберите её заново.");
  }
  const { data: signed, error: e1 } = await ctx.admin.storage.from(BUCKET).createSignedUrl(body.path, 60);
  if (e1) return jsonError(404, "upload_missing", "Печатная версия ещё не загрузилась. Попробуйте ещё раз.");
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
    return serverError("storage_unavailable", "Не получилось прочитать печатную версию. Попробуйте ещё раз.");
  }
  // Тот же кадр, что и оригинал (поворот по EXIF меняет местами ширину и высоту) — не другое фото и не уменьшенная копия
  // «Резкость для печати» (D1, edits.upscale = 2) — ровно ×2 по сторонам
  const k = body.edits?.upscale === 2 ? 2 : 1;
  const same = (a, b) => Math.abs(a - b * k) <= 2 * k;
  const fits = meta?.width && ((same(meta.width, photo.width) && same(meta.height, photo.height)) || (same(meta.width, photo.height) && same(meta.height, photo.width)));
  const problem =
    !meta || meta.mime !== "image/jpeg"
      ? ["unsupported_format", "Печатная версия должна быть JPEG."]
      : total > MAX_PHOTO_BYTES
        ? ["file_too_big", "Печатная версия больше 25 МБ."]
        : !fits
          ? ["size_mismatch", k === 2 ? "Печатная версия с резкостью должна быть ровно вдвое больше оригинала." : "Печатная версия должна быть того же размера, что и оригинал."]
          : null;
  if (problem) {
    await ctx.admin.storage.from(BUCKET).remove([body.path]).catch(() => {});
    await ctx.audit("photo.print", "photo", photoId, "denied", { reason: problem[0], bytes: total });
    return jsonError(400, problem[0], problem[1]);
  }
  const print = { path: body.path, width: meta.width, height: meta.height, bytes: total, at: new Date().toISOString() };
  const edits = { ...(body.edits || {}), print };
  const { error } = await ctx.admin.from("project_photos").update({ print_path: body.path, edits }).eq("id", photoId).eq("user_id", ctx.userId);
  if (error) {
    await ctx.admin.storage.from(BUCKET).remove([body.path]).catch(() => {});
    if (error.message === "project_ordered") return jsonError(409, "project_ordered", "Проект уже в заказе — менять фото нельзя.");
    await ctx.audit("photo.print", "photo", photoId, "error");
    return serverError();
  }
  await removeOld(body.path);
  await ctx.audit("photo.print", "photo", photoId, "success", { bytes: total, width: meta.width, height: meta.height });
  after(() => checkPhotoById(ctx, photoId).catch((e) => console.error("Фоновая проверка печатной версии:", e?.message)));
  return json({ ok: true, print });
}
