// GET /api/v1/photos/{id}/url — подписанная ссылка на просмотр фото, живёт 10 минут.
// Клиент — только свои фото; модератор — фото с флагом цензуры; админ — любые (правила RLS).
import { badId, BUCKET, notFound, requireUser, serverError } from "@/lib/server/api";
import { json } from "@/lib/server/http";

export async function GET(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request, ["client", "moderator", "admin"]);
  if (response) return response;
  if (badId(id)) return notFound("Фото");

  let q = ctx.db.from("project_photos").select("id, storage_path, user_id").eq("id", id);
  if (ctx.role === "client") q = q.eq("user_id", ctx.userId);
  const { data: photo, error } = await q.maybeSingle();
  if (error) return serverError();
  if (!photo) {
    await ctx.audit("photo.view", "photo", id, "denied", { reason: "not_found_or_foreign" });
    return notFound("Фото");
  }
  const { data, error: e2 } = await ctx.admin.storage.from(BUCKET).createSignedUrl(photo.storage_path, 600);
  if (e2) return serverError("storage_unavailable", "Хранилище фото не отвечает. Попробуйте ещё раз.");
  // Просмотр своих фото не пишем в журнал (их много); чужих — пишем
  if (photo.user_id !== ctx.userId) await ctx.audit("photo.view", "photo", id, "success", { owner: photo.user_id });
  return json({ ok: true, url: data.signedUrl, expiresIn: 600 });
}
