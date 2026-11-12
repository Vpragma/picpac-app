// POST /api/v1/push/test {} — «Проверить уведомления» в профиле (D9): тестовый пуш себе на все свои устройства.
// Текст — только шаблон. Не чаще раза в минуту. Ответ — простыми словами, что сказал push-сервис.
import { parseBody, rateLimited, requireUser, serverError, z } from "@/lib/server/api";
import { json, jsonError } from "@/lib/server/http";
import { pushToUser } from "@/lib/server/push";
import { demoPushText, pushResultText } from "@/lib/notifyRules";

export async function POST(request) {
  const { ctx, response } = await requireUser(request, ["client", "moderator", "admin"]);
  if (response) return response;
  const { response: bad } = await parseBody(request, z.strictObject({}));
  if (bad) return bad;
  if (await rateLimited(`w:push-test:${ctx.userId}`, 1, 60)) {
    const res = jsonError(429, "rate_limited", "Проверять можно раз в минуту. Подождите немного.");
    res.headers.set("Retry-After", "60");
    return res;
  }
  try {
    const sent = await pushToUser(ctx.userId, demoPushText("test"), { urgency: "high", ttl: 600 });
    const text = pushResultText(sent.results, { noVapid: sent.skipped === "no_vapid" });
    await ctx.audit("push.test", "user", ctx.userId, sent.sent > 0 ? "success" : "error", { devices: sent.results.length, accepted: sent.sent, codes: sent.results.map((x) => x.status) });
    return json({ ok: sent.sent > 0, text, devices: sent.results.length, accepted: sent.sent });
  } catch (e) {
    console.error("push-test:", e?.message);
    return serverError();
  }
}
