// POST /api/v1/auth/logout — выход: закрывает сессию и сбрасывает выбранную роль.
import { limitWrite } from "@/lib/server/api";
import { clientIp, writeAudit } from "@/lib/server/audit";
import { json, jsonError, sameOrigin } from "@/lib/server/http";
import { clearAuthCookies, getAuth } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export async function POST(request) {
  if (!sameOrigin(request)) return jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.");
  const auth = await getAuth();
  const limited = await limitWrite("logout", auth.user?.id || clientIp(request.headers), 30, 60);
  if (limited) return limited;
  if (auth.user) {
    // scope local — выходим только на этом устройстве
    await auth.supabase.auth.signOut({ scope: "local" });
    // Пуш-подписки этой сессии гаснут вместе с ней (SEC-18/19) — даже если устройство без сети не отписалось само
    if (auth.sessionId) await createSupabaseAdmin().from("push_subscriptions").delete().eq("user_id", auth.user.id).eq("session_id", auth.sessionId);
    await writeAudit({
      userId: auth.user.id,
      role: auth.activeRole,
      action: "auth.logout",
      objectType: "user",
      objectId: auth.user.id,
      result: "success",
      email: auth.user.email,
      ip: clientIp(request.headers),
    });
  }
  await clearAuthCookies();
  return json({ ok: true, redirect: "/" });
}
