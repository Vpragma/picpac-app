// POST /api/v1/admin/users/{id}/roles { role: "moderator" | "admin", grant: true | false } — выдать или снять роль (N9).
// Только роль admin. Свои роли — нельзя, последнего администратора — нельзя, демо-аккаунты и синтетику — нельзя
// (проверяет функция базы public.admin_set_role под блокировкой). Каждая попытка — запись в журнал.
import { badId, limitWrite, notFound, parseBody, requireUser, serverError, z } from "@/lib/server/api";
import { ROLE_RESULTS, setRole } from "@/lib/server/adminUsers";
import { json, jsonError } from "@/lib/server/http";
import { sortRoles } from "@/lib/roles";

const schema = z.strictObject({
  role: z.enum(["client", "moderator", "admin"], { error: "Роль — модератор или администратор." }),
  grant: z.boolean({ error: "grant — да (выдать) или нет (снять)." }),
});

export async function POST(request, { params }) {
  const { id } = await params;
  const { ctx, response } = await requireUser(request, ["admin"]);
  if (response) return response;
  if (badId(id)) return notFound("Пользователь");
  const { body, response: bad } = await parseBody(request, schema);
  if (bad) {
    await ctx.audit("admin.role_grant", "user", id, "denied", { reason: "invalid_input" });
    return bad;
  }
  const action = body.grant ? "admin.role_grant" : "admin.role_revoke";
  const limited = await limitWrite("roles", ctx.userId, 30);
  if (limited) return limited;
  let result;
  try {
    result = await setRole(ctx.auth, id, body.role, body.grant);
  } catch (e) {
    console.error(e?.message);
    await ctx.audit(action, "user", id, "error", { role: body.role, reason: "db_error" });
    return serverError();
  }
  const r = ROLE_RESULTS[result] || ROLE_RESULTS.forbidden;
  if (r.status !== 200) {
    await ctx.audit(action, "user", id, "denied", { role: body.role, reason: result });
    return jsonError(r.status, r.code, r.message);
  }
  if (result !== "unchanged") await ctx.audit(action, "user", id, "success", { role: body.role });
  const { data: rows } = await ctx.admin.from("user_roles").select("role").eq("user_id", id);
  return json({ ok: true, result, roles: sortRoles((rows || []).map((x) => x.role)) });
}
