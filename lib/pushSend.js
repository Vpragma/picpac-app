// Отправка пуша по списку подписок и разбор ответа push-сервиса (D9). Без "server-only" и без базы по умолчанию —
// чтобы unit-тест проверил: 201 — принято, 404/410 — подписка удалена, в лог — только хост и код.
import { sendNotification, WebPushError } from "web-push";
import { allowedEndpoint, pushOutcome, pushPayload, pushServiceName } from "./notifyRules.js";

// D9, причина недоставки: закрытый ключ VAPID в окружении — 31 байт вместо 32 (при создании потерян ведущий
// нулевой байт числа). web-push такой ключ отвергает ещё до отправки, и ни один пуш не уходил.
// Дополняем нулём слева: число то же, открытый ключ к нему подходит, старые подписки остаются рабочими.
export function vapidPrivateKey(raw) {
  const t = String(raw || "").trim();
  if (!t) return "";
  const b = Buffer.from(t, "base64url");
  if (b.length >= 32 || b.length < 28) return t;
  return Buffer.concat([Buffer.alloc(32 - b.length), b]).toString("base64url");
}

// Ошибка без ответа сервиса → короткая причина без значений ключей и адресов
export function failReason(e) {
  const m = String(e?.message || "");
  if (/vapid|subject/i.test(m)) return "ключи VAPID";
  return String(e?.code || "сеть").slice(0, 20);
}

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
      results.push({ service, ok: false, status: code || failReason(e) });
      // В лог — только хост и код (адрес подписки — как пароль к устройству)
      console.error("push failed", host, code || failReason(e));
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
