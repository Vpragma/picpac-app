// /api/v1/cron/cart-reminders — расписание (pg_cron + pg_net или Vercel Cron) раз в 15 минут:
// одно напоминание на забытую корзину и пуши по новым важным уведомлениям.
// Без верного секрета (Authorization: Bearer <CRON_SECRET>) — 401 без подробностей.
// POST — pg_net; GET — Vercel Cron (он шлёт GET с тем же заголовком).
import { cronAuthorized } from "@/lib/server/cron";
import { json, jsonError } from "@/lib/server/http";
import { runCartReminders } from "@/lib/server/reminders";

async function run(request) {
  if (!cronAuthorized(request)) return jsonError(401, "unauthorized", "Нужен секрет расписания.");
  try {
    return json({ ok: true, ...(await runCartReminders({ source: "cron" })) });
  } catch (e) {
    console.error(e?.message);
    return jsonError(500, "reminders_failed", "Напоминания не отправились. Попробуем в следующий запуск.");
  }
}

export const POST = run;
export const GET = run;
