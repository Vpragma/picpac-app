// POST /api/v1/notifications/read { all: true } | { ids: [uuid, …] } — отметить прочитанными.
// Чужие id молча не трогаются: запись идёт с фильтром по владельцу.
import { limitWrite, parseBody, requireUser, serverError, uuid, z } from "@/lib/server/api";
import { json } from "@/lib/server/http";
import { unreadCount } from "@/lib/server/notifications";

const schema = z
  .strictObject({ all: z.literal(true).optional(), ids: z.array(uuid).min(1).max(100).optional() })
  .refine((b) => !!b.all !== !!b.ids, { message: "Укажите all: true или список ids.", path: ["ids"] });

export async function POST(request) {
  const { ctx, response } = await requireUser(request);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) return bad;
  const limited = await limitWrite("notif-read", ctx.userId, 120);
  if (limited) return limited;
  let q = ctx.admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ctx.userId).is("read_at", null);
  if (body.ids) q = q.in("id", body.ids);
  const { data, error } = await q.select("id");
  if (error) return serverError();
  return json({ ok: true, marked: data.length, unread: await unreadCount(ctx) });
}
