// Данные правок фото (photo.edits) — лёгкий модуль без пиксельной математики:
// его используют синхронизация (lib/sync.js), значки и редактор. Формат — в начале lib/photo/adjust.js.
const KEYS = ["exposure", "contrast", "warmth", "saturation", "highlights", "shadows"];

// Предел правок одного фото, который принимает сервер печатной версии (PUT …/print { edits }), и способ счёта —
// один и тот же у редактора, печати и сервера (длина JSON). Маски выделения хранятся один раз (edits.masks).
export const PHOTO_EDITS_MAX = 20_000;
export function editsBytes(e) {
  return JSON.stringify(e ?? {}).length;
}

// Маски выделения (D1): { ключ: { w, h, rle } } — только правильные записи
function cleanMasks(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const out = {};
  for (const [k, v] of Object.entries(m)) {
    if (/^[a-z0-9]{1,20}$/.test(k) && v && Number.isInteger(v.w) && Number.isInteger(v.h) && v.w > 0 && v.h > 0 && typeof v.rle === "string") out[k] = { w: v.w, h: v.h, rle: v.rle };
  }
  return Object.keys(out).length ? out : null;
}

export function emptyEdits() {
  return { v: 1, auto: null, autoOff: false, manual: {}, ops: [] };
}

export function normEdits(e) {
  const x = e && typeof e === "object" ? e : {};
  const masks = cleanMasks(x.masks);
  return {
    v: 1,
    auto: x.auto && typeof x.auto === "object" ? x.auto : null,
    autoOff: !!x.autoOff,
    manual: x.manual && typeof x.manual === "object" ? x.manual : {},
    ops: Array.isArray(x.ops) ? x.ops : [],
    ...(x.by ? { by: x.by } : {}),
    // «Резкость для печати» ×2 (D1): файл ×2 хранится на устройстве, в правках — только множитель
    ...(x.upscale === 2 ? { upscale: 2 } : {}),
    ...(masks ? { masks } : {}),
  };
}

// Есть ли ручные правки (ползунки, команды, местные правки, резкость) — значок «ИИ»
export function hasManual(e) {
  if (!e) return false;
  const m = e.manual || {};
  return KEYS.some((k) => Math.abs(m[k] || 0) >= 0.5) || (e.ops || []).length > 0 || e.upscale === 2;
}

// Автоулучшение действует — значок «Улучшено»
export function hasAuto(e) {
  return !!(e && e.auto && !e.autoOff);
}

export function isEdited(e) {
  return hasAuto(e) || hasManual(e);
}

// Компактный вид для синхронизации (settings.edits на сервере): null — правок нет
export function compactEdits(e) {
  const ed = normEdits(e);
  if (!ed.auto && !ed.autoOff && !hasManual(ed)) return null;
  return ed;
}
