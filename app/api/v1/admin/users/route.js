// GET /api/v1/admin/users?q=&role=client|moderator|admin&tests=1&page= — пользователи для администратора (N9).
// Только роль admin. Почта и имя замаскированы; поиск — по части почты, имени или началу id.
import { listUsers, userFilters, userParams } from "@/lib/server/adminUsers";
import { json, jsonError } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";

export async function GET(request) {
  const { auth, response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  const parsed = userFilters.safeParse(userParams(new URL(request.url).searchParams));
  if (!parsed.success) return jsonError(400, "bad_request", `Неверный фильтр. ${parsed.error.issues[0]?.message || ""}`.trim());
  try {
    return json({ ok: true, ...(await listUsers(auth, parsed.data)) });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "users_unavailable", "Не получилось загрузить пользователей. Попробуйте ещё раз.");
  }
}
