// Подмена ответов Cloudflare для локальных тестов (AI_CLOUD_FAKE=1, не на Vercel) и unit-тестов.
// Формы ответов — как у настоящих моделей (см. docs/night/research-d6.md).

export function fakeCommandResult(text) {
  const t = String(text || "").toLowerCase();
  let answer;
  if (/кино|ретро|винтаж/.test(t)) answer = { ops: [{ op: "adjust", saturation: -30, contrast: 15, warmth: 10 }], say: "Сделал как в старом кино" };
  else if (/найди|выдели/.test(t)) answer = { ops: [{ op: "find", target: "dog" }], say: "Ищу собаку" };
  else if (/убери|удали|сотри/.test(t)) answer = { ops: [{ op: "remove", target: "ball" }], say: "Убираю мяч" };
  else answer = { ops: [], say: "Такого редактор пока не умеет" };
  // Как у gpt-oss через /run: текст с JSON внутри, счётчики токенов
  return { response: "Вот ответ:\n```json\n" + JSON.stringify(answer) + "\n```", usage: { prompt_tokens: 420, completion_tokens: 380 } };
}

export function fakeDetectResult() {
  return { objects: [{ x_min: 0.3, y_min: 0.4, x_max: 0.62, y_max: 0.86 }], metrics: { input_tokens: 760, output_tokens: 24 } };
}

// Маленький PNG 1×1 (серый) — ответ FLUX
export function fakeEditResult() {
  return { image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==" };
}
