// Сравнение секретов в постоянное время: по хешам SHA-256 одинаковой длины, timingSafeEqual.
// Без "server-only", чтобы функцию проверял unit-тест. В браузер не попадает: импортируют только маршруты API.
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (v) => createHash("sha256").update(String(v ?? ""), "utf8").digest();

// true, только если оба значения непустые и совпадают
export function safeEqual(given, expected) {
  if (!given || !expected) return false;
  return timingSafeEqual(digest(given), digest(expected));
}

// Значение из заголовка «Authorization: Bearer <секрет>» или ""
export function bearer(headers) {
  const h = headers.get("authorization") || "";
  const m = /^Bearer\s+(\S{1,500})$/i.exec(h.trim());
  return m ? m[1] : "";
}
