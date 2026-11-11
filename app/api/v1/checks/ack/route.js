// POST /api/v1/checks/ack — «Продолжить всё равно» на шаге «Проверка»: клиент осознанно оставил фото
// с предупреждением (размыто, формат, пустые страницы). Пишем в журнал действий (audit_log).
// Только для вошедших; гость хранит отметку в проекте на устройстве. Лимит — 60 отметок в минуту.
import { parseBody, rateLimited, requireUser, tooMany, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";

const schema = z.object({
  issue: z.string().trim().min(1, "Не указано предупреждение.").max(80, "Слишком длинный код предупреждения."),
  title: z.string().trim().max(120, "Слишком длинный заголовок.").optional(),
  productSlug: z.string().regex(/^[a-z0-9-]{2,40}$/, "Выберите продукт из каталога.").optional(),
  projectId: z.string().max(64, "Слишком длинный идентификатор проекта.").optional(),
});

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  if (await rateLimited("ack:" + ctx.userId, 60, 60)) return tooMany(60);
  await ctx.audit("check.continue_anyway", "project", null, "success", {
    issue: body.issue,
    title: body.title || null,
    product: body.productSlug || null,
    localProject: body.projectId || null,
  });
  return json({ ok: true });
}
