// Данные правок фото (photo.edits) — лёгкий модуль без пиксельной математики:
// его используют синхронизация (lib/sync.js), значки и редактор. Формат — в начале lib/photo/adjust.js.
const KEYS = ["exposure", "contrast", "warmth", "saturation", "highlights", "shadows"];
// Стиль (N3, пресеты «ч/б», «сепия», «винтаж», «старое кино»): edits.look = { mono, sepia, fade }, каждое 0…100.
// Применяется после света и цвета (lib/photo/adjust.js) — одинаково в превью и в печатной версии.
export const LOOK_KEYS = ["mono", "sepia", "fade"];
export function cleanLook(l) {
  if (!l || typeof l !== "object" || Array.isArray(l)) return null;
  const out = {};
  for (const k of LOOK_KEYS) {
    const v = Math.round(Number(l[k]) || 0);
    if (v > 0) out[k] = Math.min(100, v);
  }
  return Object.keys(out).length ? out : null;
}

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
  const look = cleanLook(x.look);
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
    ...(look ? { look } : {}),
  };
}

// Есть ли ручные правки (ползунки, команды, местные правки, резкость) — значок «ИИ»
export function hasManual(e) {
  if (!e) return false;
  const m = e.manual || {};
  return KEYS.some((k) => Math.abs(m[k] || 0) >= 0.5) || (e.ops || []).length > 0 || e.upscale === 2 || !!cleanLook(e.look);
}

// Автоулучшение действует — значок «Улучшено»
export function hasAuto(e) {
  return !!(e && e.auto && !e.autoOff);
}

export function isEdited(e) {
  return hasAuto(e) || hasManual(e);
}

// Компактный вид правок на устройстве (проект в IndexedDB, печатная версия): null — правок нет
export function compactEdits(e) {
  const ed = normEdits(e);
  if (!ed.auto && !ed.autoOff && !hasManual(ed)) return null;
  return ed;
}

// N7 (круг 0, требование жюри N3): что из правок фото уходит на сервер — только общие параметры: автоулучшение
// и ползунки (числа), стиль (look), «Резкость ×2» (upscale), откуда последняя правка (by). Местные правки
// (edits.ops — маски выделения, ластик, «убери солнце» с координатами) и сами маски (edits.masks) остаются
// на устройстве: печатную версию с ними собирает устройство при заказе (lib/photo/print.js) — в печать уходит готовый файл.
// local — сколько местных правок у фото (только число, без содержимого): на другом устройстве редактор честно
// скажет, что их там нет. elsewhere — такое же число, пришедшее с сервера (правки сделаны на другом устройстве).
// Тот же отбор делает и сервер (lib/server/projects.js), если старая версия приложения пришлёт лишнее.
const nums = (o, keys) => {
  const out = {};
  if (!o || typeof o !== "object" || Array.isArray(o)) return out;
  for (const k of keys) {
    const v = Number(o[k]);
    if (Number.isFinite(v) && v !== 0) out[k] = Math.max(-200, Math.min(200, v));
  }
  return out;
};
export function serverEdits(e, elsewhere = 0) {
  const ed = normEdits(e);
  const local = ed.ops.length || Math.max(0, Math.min(99, Math.round(Number(elsewhere) || 0)));
  let auto = null;
  if (ed.auto) {
    auto = nums(ed.auto, KEYS);
    const wb = ed.auto.wb;
    if (Array.isArray(wb) && wb.length === 3 && wb.every((g) => Number.isFinite(Number(g)))) auto.wb = wb.map((g) => Math.max(0.5, Math.min(2, Number(g))));
  }
  const out = { v: 1, auto, autoOff: ed.autoOff, manual: nums(ed.manual, KEYS) };
  if (ed.by === "command" || ed.by === "slider") out.by = ed.by;
  if (ed.upscale === 2) out.upscale = 2;
  const look = cleanLook(ed.look);
  if (look) out.look = look;
  if (local) out.local = local;
  if (!out.auto && !out.autoOff && !local && !hasManual(out)) return null;
  return out;
}

// Правки фото всех фото проекта (settings.edits: { id фото: правки }) в виде для сервера
export function serverEditsMap(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [id, e] of Object.entries(map)) {
    const s = serverEdits(e, e?.local);
    if (s) out[id] = s;
  }
  return out;
}
