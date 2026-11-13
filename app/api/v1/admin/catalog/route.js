// GET /api/v1/admin/catalog — каталог для правки администратором (N9): цены, коэффициенты размеров, плашки,
// старая цена. Только роль admin.
import { BADGES, LIMITS, loadAdminCatalog } from "@/lib/server/adminCatalog";
import { json, jsonError } from "@/lib/server/http";
import { requireApiRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function GET(request) {
  const { response } = await requireApiRole(request, ["admin"]);
  if (response) return response;
  try {
    return json({ ok: true, currency: "BYN", badges: BADGES, limits: LIMITS, products: await loadAdminCatalog(createSupabaseAdmin()) });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "catalog_unavailable", "Не получилось загрузить каталог. Попробуйте ещё раз.");
  }
}
