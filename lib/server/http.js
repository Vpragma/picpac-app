import "server-only";
// Общие помощники для обработчиков /api/v1.

// Ответы API не кэшируются: в них личные данные и cookies сессии
export function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

// Единый формат ошибки: { ok: false, error: { code, message, requestId, ...extra } }.
// extra (например, fields) дублируется и на верхнем уровне — так его читают старые экраны.
// requestId есть и в заголовке X-Request-Id: по нему ошибку легко найти в логах.
export function jsonError(status, code, message, extra = {}) {
  const requestId = crypto.randomUUID();
  const res = json({ ok: false, error: { code, message, requestId, ...extra }, ...extra }, status);
  res.headers.set("X-Request-Id", requestId);
  return res;
}

// Защита от подделки запросов с чужих сайтов (CSRF): браузер всегда присылает Origin,
// и он должен совпадать с нашим адресом. Скрипты без Origin (тесты, curl) пропускаем:
// у них нет cookies жертвы.
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Тело запроса — только JSON. Обычная HTML-форма с чужого сайта такое прислать не может.
export async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) return null;
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

// Начало каждого изменяющего обработчика: проверка источника и разбор JSON
export async function readMutation(request) {
  if (!sameOrigin(request)) return { response: jsonError(403, "bad_origin", "Запрос отклонён: он пришёл с другого сайта.") };
  const body = await readJson(request);
  if (!body) return { response: jsonError(400, "bad_request", "Не получилось прочитать данные запроса. Обновите страницу и попробуйте ещё раз.") };
  return { body };
}
