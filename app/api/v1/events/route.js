// POST /api/v1/events { sid, events: [{ type, step?, durationMs?, props? }] } — обезличенные события воронки пачкой (до 50).
// Без персональных данных: сеанс — случайный id (меняется раз в сутки), пользователя сервер записывает только хешем с солью.
// Лимит частоты (→ 429): 30 пачек в минуту на сеанс и 300 в минуту с одного IP (IP — только хешем в ключе лимита).
import { parseBody, rateLimited, serverError, tooMany, z } from "@/lib/server/api";
import { CLIENT_EVENTS, EDITOR_STEPS } from "@/lib/analyticsCore";
import { ipKey, userHash } from "@/lib/server/analytics";
import { clientIp } from "@/lib/server/audit";
import { json } from "@/lib/server/http";
import { getAuth } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

const PER_SESSION = 30;
const PER_IP = 300;

const event = z.strictObject({
  type: z.enum(CLIENT_EVENTS, { error: "Неизвестное событие." }),
  step: z.enum(EDITOR_STEPS).optional(),
  durationMs: z.number().int().min(0).max(3_600_000).optional(),
  // Только короткие технические значения: ни текста, ни имён
  props: z
    .strictObject({
      product: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
      kind: z.enum(["auto", "command", "local", "cloud"]).optional(),
      count: z.number().int().min(0).max(500).optional(),
    })
    .optional(),
});

const schema = z.strictObject({
  sid: z.string().regex(/^[a-f0-9]{24}$/, "Неверный id сеанса."),
  events: z.array(event).min(1).max(50),
});

export async function POST(request) {
  const ip = ipKey(clientIp(request.headers));
  if (await rateLimited(`events-ip:${ip}`, PER_IP, 60)) return tooMany();
  const { body, response } = await parseBody(request, schema);
  if (response) return response;
  if (await rateLimited(`events:${ip}:${body.sid}`, PER_SESSION, 60)) return tooMany();

  let uh = null;
  try {
    const auth = await getAuth();
    uh = userHash(auth.user?.id);
  } catch {
    uh = null;
  }
  const rows = body.events.map((e) => ({
    type: e.type,
    session_id: body.sid,
    user_hash: uh,
    step: e.step || null,
    duration_ms: e.durationMs ?? null,
    props: e.props || {},
  }));
  const { error } = await createSupabaseAdmin().from("analytics_events").insert(rows);
  if (error) {
    console.error("events:", error.message);
    return serverError();
  }
  return json({ ok: true, accepted: rows.length }, 202);
}
