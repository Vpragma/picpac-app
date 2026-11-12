// /api/v1/admin/audit — журнал действий. Только для роли admin.
// Права проверяются дважды: в proxy.js и здесь. Без входа — 401, без роли admin — 403.
// GET ?action=auth.*|order.create&result=&user=&objectType=&objectId=&from=ГГГГ-ММ-ДД&to=&before=&limit=
//   — фильтры (SEC-15). Без параметров — как раньше: последние 100 записей.
// POST { email, ...те же фильтры } — поиск по почте: почту передаём только телом запроса, не в адресе.
import { parseBody } from "@/lib/server/api";
import { auditEmailSearch, auditFilters, filtersFromParams, queryAudit } from "@/lib/server/auditRead";
import { json, jsonError } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";

function badFilters(error) {
  const first = error.issues?.[0];
  const where = first?.path?.length ? `«${first.path.join(".")}»: ` : "";
  return jsonError(400, "bad_request", `Неверный фильтр журнала. ${where}${first?.message || ""}`.trim());
}

async function answer(auth, f) {
  try {
    const { items, next } = await queryAudit(auth.supabase, f);
    return json({ ok: true, timezone: "Europe/Minsk", items, next });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "audit_unavailable", "Не получилось загрузить журнал. Попробуйте ещё раз.");
  }
}

export async function GET(request) {
  const { auth, response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  const parsed = auditFilters.safeParse(filtersFromParams(new URL(request.url).searchParams));
  if (!parsed.success) return badFilters(parsed.error);
  return answer(auth, { limit: 100, ...parsed.data });
}

export async function POST(request) {
  const { auth, response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  const { body, response: bad } = await parseBody(request, auditEmailSearch);
  if (bad) return bad;
  return answer(auth, { limit: 50, ...body });
}
