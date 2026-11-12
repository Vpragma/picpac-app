// /api/v1/admin/notifications — лента сотрудника: админ видит все заказы и обращения, модератор — только модерацию.
// GET → { items, unread }; POST {} → «Прочитать все» (отметка времени просмотра).
import { limitWrite, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { staffFeed } from "@/lib/server/notifications";

const STAFF = ["moderator", "admin"];

export async function GET(request) {
  const { ctx, response } = await requireUser(request, STAFF);
  if (response) return response;
  try {
    return json({ ok: true, ...(await staffFeed(ctx)) });
  } catch (e) {
    console.error(e?.message);
    return serverError();
  }
}

export async function POST(request) {
  const { ctx, response } = await requireUser(request, STAFF);
  if (response) return response;
  const { response: bad } = await parseBody(request, z.strictObject({}));
  if (bad) return bad;
  const limited = await limitWrite("staff-seen", ctx.userId, 60);
  if (limited) return limited;
  const { error } = await ctx.admin.from("staff_notification_reads").upsert({ user_id: ctx.userId, seen_at: new Date().toISOString() });
  if (error) return serverError();
  return json({ ok: true, unread: 0 });
}
