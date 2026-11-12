// /api/v1/admin/cart-reminders — только роль admin.
// GET — текущая задержка напоминания; POST {} — «Отправить напоминания сейчас» (те же правила, что у расписания:
// тихие часы, одно напоминание на корзину); PUT { afterMinutes: 5 | 60 | 1440 } — задержка (5 мин — для демо).
import { limitWrite, parseBody, requireUser, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { runCartReminders } from "@/lib/server/reminders";

const AFTER = [5, 60, 1440];
const putSchema = z.strictObject({ afterMinutes: z.union(AFTER.map((n) => z.literal(n))) });

export async function GET(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const { data } = await ctx.admin.rpc("app_setting", { _key: "cart_reminder_after_minutes" });
  return json({ ok: true, afterMinutes: Number(data) > 0 ? Number(data) : 1440, choices: AFTER });
}

export async function POST(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const limited = await limitWrite("cart-reminders", ctx.userId, 6, 60);
  if (limited) return limited;
  const { response: bad } = await parseBody(request, z.strictObject({}));
  if (bad) return bad;
  try {
    return json({ ok: true, ...(await runCartReminders({ source: "admin", actorId: ctx.userId })) });
  } catch (e) {
    console.error(e?.message);
    await ctx.audit("admin.cart_reminders_now", "cart", null, "error");
    return jsonError(500, "reminders_failed", "Не получилось отправить напоминания. Попробуйте ещё раз.");
  }
}

export async function PUT(request) {
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, putSchema);
  if (bad) return bad;
  const { error } = await ctx.admin.rpc("set_app_setting", { _key: "cart_reminder_after_minutes", _value: body.afterMinutes });
  if (error) return jsonError(500, "settings_failed", "Не получилось сохранить настройку.");
  await ctx.audit("admin.settings", "settings", "cart_reminder_after_minutes", "success", { value: body.afterMinutes });
  return json({ ok: true, afterMinutes: body.afterMinutes });
}
