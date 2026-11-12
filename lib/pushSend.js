// Отправка пуша по списку подписок и разбор ответа push-сервиса (D9). Без "server-only" и без базы по умолчанию —
// чтобы unit-тест проверил: 201 — принято, 404/410 — подписка удалена, в лог — только хост и код.
import { sendNotification, WebPushError } from "web-push";
import { allowedEndpoint, pushOutcome, pushPayload, pushServiceName } from "./notifyRules.js";

// Отправка по готовому списку подписок (отдельно — чтобы проверить unit-тестом без базы и сети)
export async function sendToSubscriptions(admin, subs, message, { keys, ttl = 3600, urgency = "normal", topic, send = sendNotification }) {
  let sent = 0;
  let failed = 0;
  let removed = 0;
  const results = [];
  for (const s of subs) {
    if (!allowedEndpoint(s.endpoint)) continue; // старые строки без проверки — сеть не трогаем
    const host = hostOf(s.endpoint);
    const service = pushServiceName(host);
    try {
      const res = await send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, pushPayload(message), {
        vapidDetails: keys,
        TTL: ttl,
        urgency,
        ...(topic ? { topic } : {}),
        timeout: 10000,
      });
      sent++;
      results.push({ service, ok: true, status: Number(res?.statusCode) || 201 });
      await admin.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      failed++;
      const code = e instanceof WebPushError || e?.statusCode ? e.statusCode : 0;
      const out = pushOutcome(code);
      results.push({ service, ok: false, status: code || String(e?.code || "network").slice(0, 20) });
      // В лог — только хост и код (адрес подписки — как пароль к устройству)
      console.error("push failed", host, code || String(e?.code || e?.message || e).slice(0, 80));
      if (out.remove) {
        await admin.from("push_subscriptions").delete().eq("id", s.id); // подписка умерла
        removed++;
      }
    }
  }
  return { sent, failed, removed, results };
}


function hostOf(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return "?";
  }
}
