import "server-only";
// Секрет расписания: Authorization: Bearer <CRON_SECRET>, сравнение за постоянное время (хеши одной длины)
import { createHash, timingSafeEqual } from "node:crypto";

export function cronAuthorized(request) {
  const secret = process.env.CRON_SECRET || "";
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (secret.length < 32 || !got) return false;
  const h = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(secret));
}
