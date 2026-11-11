// GET /api/v1/admin/audit?limit=100 — последние записи журнала действий. Только для роли admin.
// Права проверяются дважды: в proxy.js и здесь. Без входа — 401, без роли admin — 403.
import { loadAudit } from "@/lib/server/auditRead";
import { json, jsonError } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";

export async function GET(request) {
  const { auth, response } = await requireApiRole(request, ["admin"]);
  if (response) return response;

  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, 100) : 100;
  try {
    const items = await loadAudit(auth.supabase, limit);
    return json({ ok: true, timezone: "Europe/Minsk", items });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "audit_unavailable", "Не получилось загрузить журнал. Попробуйте ещё раз.");
  }
}
