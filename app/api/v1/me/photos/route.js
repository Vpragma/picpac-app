// DELETE /api/v1/me/photos — удалить все мои фото (файлы в хранилище и записи).
// Фото заказов в работе удалить сразу нельзя: на них создаётся запрос на удаление (data_requests),
// фото удалятся после завершения заказа. Ответ: { deleted, kept, request }.
import { deleteUserPhotos } from "@/lib/server/account";
import { limitWrite, requireUser, serverError } from "@/lib/server/api";
import { json, jsonError, sameOrigin } from "@/lib/server/http";

export async function DELETE(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const limited = await limitWrite("me-photos", ctx.userId, 10, 600);
  if (limited) return limited;
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  try {
    const result = await deleteUserPhotos(ctx.admin, ctx.userId);
    await ctx.audit("account.delete_photos", "user", ctx.userId, "success", { deleted: result.deleted, kept: result.kept });
    const message = result.kept
      ? `Удалено фото: ${result.deleted}. Ещё ${result.kept} — в заказах, которые печатаются: удалим их после завершения заказа.`
      : `Удалено фото: ${result.deleted}.`;
    return json({ ok: true, message, ...result });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("account.delete_photos", "user", ctx.userId, "error");
    return serverError();
  }
}
