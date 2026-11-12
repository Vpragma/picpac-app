// Модерация фото: разбор оценок моделей в слова, пороги флага и причины возврата. Общий файл (сервер, экраны, unit).
//
// Оценки v2 (N4) — lib/photo/moderationModel.js: nsfw — классификатор обнажённости (Marqo, ViT-tiny),
// breast / nude / sex / nazi / weapon / blood / drugs — доли классов CLIP (нулевой выстрел).
// Пороги подобраны на наборе ~/Documents/hackathon/moderation-test (scripts/moderation-eval.mjs, docs/ai.md):
// medium — «Возможно: … (средняя уверенность)», high — «Найдено: … (высокая уверенность)».
// Флаг «проверит модератор» = хотя бы одна находка. Автоматика никогда не отклоняет — решает человек.
// Старые оценки nsfwjs (porn / hentai / sexy) разбираются по прежним порогам: porn + hentai > 0,7, sexy > 0,85.

export const THRESHOLDS = {
  nsfw: { medium: 0.45, high: 0.75 }, // вероятность «nsfw» у классификатора обнажённости
  nudity: { medium: 0.3, high: 0.6 }, // CLIP: обнажённая грудь + обнажённое тело + сцена сексуального характера
  nazi: { medium: 0.3, high: 0.6 },
  weapon: { medium: 0.35, high: 0.7 },
  blood: { medium: 0.35, high: 0.7 },
  drugs: { medium: 0.35, high: 0.7 },
};

// Доля «скульптура / картина» у CLIP, при которой одного классификатора обнажённости недостаточно для флага
export const ART_ONLY = 0.5;

export const LEGACY_THRESHOLDS = { pornHentai: 0.7, sexy: 0.85 };
// Прежнее имя (D4) — для старого кода и тестов
export const NSFW_THRESHOLDS = LEGACY_THRESHOLDS;

export const FINDING_LABELS = {
  breast: "обнажённая грудь",
  nude: "обнажённое тело",
  sex: "сцена сексуального характера",
  nudity: "обнажённость",
  nazi: "нацистская символика",
  weapon: "оружие",
  blood: "кровь или насилие",
  drugs: "наркотики",
  explicit: "откровенное содержание",
  suggestive: "откровенное фото",
  unchecked: "автоматическая проверка не прошла — посмотрите фото",
  demo: "пометка для показа модерации (демо)",
};

export const LEVEL_LABELS = { high: "высокая уверенность", medium: "средняя уверенность" };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const RANK = { high: 2, medium: 1 };

function level(v, t) {
  if (v >= t.high) return "high";
  if (v >= t.medium) return "medium";
  return null;
}

// Находки по оценкам: [{ id, level }] — сначала «высокая уверенность». Пустой список — флага нет.
export function findings(scores) {
  if (!scores || typeof scores !== "object") return [];
  if (scores.unchecked) return [{ id: "unchecked", level: "medium" }];
  if (scores.demo) return [{ id: "demo", level: "medium" }];
  if (num(scores.v) < 2) {
    const out = [];
    if (num(scores.porn) + num(scores.hentai) > LEGACY_THRESHOLDS.pornHentai) out.push({ id: "explicit", level: "high" });
    else if (num(scores.sexy) > LEGACY_THRESHOLDS.sexy) out.push({ id: "suggestive", level: "medium" });
    return out;
  }
  const out = [];
  // Обнажённость: классификатор + CLIP. Слово — по самому вероятному классу CLIP, иначе общее «обнажённость».
  const parts = { breast: num(scores.breast), nude: num(scores.nude), sex: num(scores.sex) };
  const clip = parts.breast + parts.nude + parts.sex;
  const byClip = level(clip, THRESHOLDS.nudity);
  // Скульптура или картина (CLIP «art» ≥ 0,5) без подтверждения от CLIP: одного классификатора мало — он путает
  // мраморную статую в музее с обнажённым телом. Живое обнажённое тело CLIP узнаёт сам (byClip).
  const byModel = num(scores.art) >= ART_ONLY && !byClip ? null : level(num(scores.nsfw), THRESHOLDS.nsfw);
  let nud = byModel === "high" || byClip === "high" || (byModel && byClip) ? "high" : byModel || byClip;
  if (nud) {
    const best = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
    out.push({ id: best[1] >= 0.05 ? best[0] : "nudity", level: nud });
  }
  for (const id of ["nazi", "weapon", "blood", "drugs"]) {
    const l = level(num(scores[id]), THRESHOLDS[id]);
    if (l) out.push({ id, level: l });
  }
  return out.sort((a, b) => RANK[b.level] - RANK[a.level]);
}

// Флаг «проверит модератор»
export const needsModeration = (scores) => findings(scores).length > 0;

// «Найдено: обнажённая грудь (высокая уверенность)» / «Возможно: нацистская символика (средняя уверенность)»
export function describeFinding(f) {
  if (f?.id === "demo") return "Демо: фото помечено вручную для показа модерации";
  if (f?.id === "unchecked") return "Автоматическая проверка не прошла — посмотрите фото";
  const what = FINDING_LABELS[f?.id] || "подозрительное содержание";
  return f?.level === "high" ? `Найдено: ${what} (${LEVEL_LABELS.high})` : `Возможно: ${what} (${LEVEL_LABELS.medium})`;
}

// Находки для экрана модератора: verdict — проверка сервера (project_photos.moderation), device — оценки с устройства.
// Слова пересчитываются из сохранённых оценок, поэтому новые пороги действуют и на старые записи.
// source: "server" | "device" | "none" — откуда вывод (на экране: «проверка сервера» / «проверка на телефоне клиента»).
export function reviewFindings({ verdict, device } = {}) {
  const dev = findings(device);
  if (verdict?.unchecked) return { source: "server", list: [{ id: "unchecked", level: "medium" }, ...dev] };
  const server = verdict?.scores ? findings(verdict.scores) : [];
  if (server.length) return { source: "server", list: server };
  if (dev.length) return { source: "device", list: dev };
  return { source: verdict?.scores ? "server" : "none", list: [] };
}

// Коротко для журнала: ["breast:high", "nazi:medium"]
export const findingCodes = (list) => (list || []).map((f) => `${f.id}:${f.level}`);

export const RETURN_REASONS = {
  explicit: "Откровенное содержание — такое не печатаем",
  violence: "Жестокость",
  personal_data: "Видны документы или чужие личные данные",
  rights: "Чужие права (логотип, кадр из фильма)",
  quality: "Не подходит для печати",
  other: "Другое",
};

// Шаблоны комментария клиенту для каждой причины (модератор может поправить текст)
export const RETURN_TEMPLATES = {
  explicit: "На фото есть откровенное содержание — такие фото мы не печатаем. Пожалуйста, замените его другим.",
  violence: "На фото есть сцены жестокости, оружие или запрещённая символика — такое мы не печатаем. Замените, пожалуйста, фото.",
  personal_data: "На фото видны документы или чужие личные данные. Замените фото или закройте эти данные.",
  rights: "На фото чужой логотип или кадр, права на который принадлежат другим. Замените, пожалуйста, фото.",
  quality: "Это фото плохо получится в печати. Замените его на более чёткое.",
  other: "",
};

// Какая причина подходит к находке модели (подсказка в форме возврата)
export const REASON_FOR_FINDING = {
  breast: "explicit",
  nude: "explicit",
  sex: "explicit",
  nudity: "explicit",
  explicit: "explicit",
  suggestive: "explicit",
  nazi: "violence",
  weapon: "violence",
  blood: "violence",
  drugs: "other",
};
