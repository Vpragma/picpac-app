import { normEdits } from "./edits.js";

// Правки света и цвета — чистые функции без DOM.
// Одна и та же математика работает в превью редактора (canvas), в unit-тестах (node)
// и в будущей печатной версии (OffscreenCanvas в воркере, S03e).
//
// Правки фото неразрушающие (МП-03): оригинал не меняется, в проекте хранится только photo.edits:
// {
//   v: 1,
//   auto: { exposure, contrast, highlights, shadows, saturation, wb: [r, g, b] } | null — автоулучшение,
//   autoOff: true — пользователь отменил автоулучшение этого фото,
//   manual: { exposure, contrast, warmth, saturation, highlights, shadows } — ползунки и команды (−100…100),
//   ops: [] — местные правки по маске (S03c: размытие фона, ластик, облако), применяются после света и цвета,
//   by: "command" | "slider" — откуда последняя ручная правка (для значка «ИИ»)
// }

export const ADJUST_KEYS = ["exposure", "contrast", "warmth", "saturation", "highlights", "shadows"];
export const ADJUST_LABELS = {
  exposure: "Яркость",
  contrast: "Контраст",
  warmth: "Тепло",
  saturation: "Насыщенность",
  highlights: "Светлые",
  shadows: "Тени",
};
export const LIMIT = 100; // ручная правка (ползунок, команда): −100…100
const TOTAL = 200; // вместе с автоулучшением — шире, чтобы «ярче» работало и после сильного автоулучшения

// Данные правок (лёгкий модуль без пиксельной математики — его использует и синхронизация)
export { emptyEdits, normEdits, hasManual, hasAuto, isEdited, compactEdits } from "./edits.js";

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const round = (v) => Math.round(v * 10) / 10;

// Итоговые параметры: автоулучшение (если не отменено) + ручные правки
export function effectiveParams(e) {
  const ed = normEdits(e);
  const out = { exposure: 0, contrast: 0, warmth: 0, saturation: 0, highlights: 0, shadows: 0, wb: [1, 1, 1] };
  if (ed.auto && !ed.autoOff) {
    for (const k of ADJUST_KEYS) out[k] += Number(ed.auto[k]) || 0;
    if (Array.isArray(ed.auto.wb) && ed.auto.wb.length === 3) out.wb = ed.auto.wb.map((g) => clamp(Number(g) || 1, 0.6, 1.6));
  }
  for (const k of ADJUST_KEYS) out[k] = clamp(out[k] + (Number(ed.manual[k]) || 0), -TOTAL, TOTAL);
  return out;
}

export function isIdentity(p) {
  return ADJUST_KEYS.every((k) => Math.abs(p[k] || 0) < 0.5) && (p.wb || [1, 1, 1]).every((g) => Math.abs(g - 1) < 0.002);
}

// Тональная кривая одного канала (значение 0…1 → 0…1)
function tone(v, p) {
  const e = p.exposure / 100;
  const c = p.contrast / 100;
  const h = p.highlights / 100;
  const s = p.shadows / 100;
  // экспозиция: усиление 2^(1,2·e) с мягким «плечом», чтобы светлое не выгорало в белое
  let x = v * Math.pow(2, 1.2 * e);
  if (x > 0.8) x = 0.8 + 0.2 * (1 - Math.exp(-(x - 0.8) / 0.2));
  // тени (пик на 1/3) и светлые (пик на 2/3)
  const ws = 6.75 * x * (1 - x) * (1 - x);
  const wh = 6.75 * x * x * (1 - x);
  x = x + 0.3 * s * ws + 0.3 * h * wh;
  // контраст вокруг середины
  x = 0.5 + (x - 0.5) * (1 + 0.6 * c);
  return clamp(x, 0, 1);
}

// Таблицы 256 значений на канал (баланс белого и «Тепло» — усиление канала до кривой)
export function buildLuts(p) {
  const w = p.warmth / 100;
  const gains = [(p.wb?.[0] ?? 1) * (1 + 0.12 * w), (p.wb?.[1] ?? 1) * (1 + 0.02 * w), (p.wb?.[2] ?? 1) * (1 - 0.12 * w)];
  return gains.map((g) => {
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * tone(clamp((i / 255) * g, 0, 1), p));
    return lut;
  });
}

// Применить параметры к пикселям RGBA (Uint8ClampedArray). Пишет в out (можно out === src).
export function applyParams(src, out, p) {
  if (isIdentity(p)) {
    if (out !== src) out.set(src);
    return out;
  }
  const [lr, lg, lb] = buildLuts(p);
  const sat = 1 + 0.8 * (p.saturation / 100);
  const n = src.length;
  if (Math.abs(sat - 1) < 0.004) {
    for (let i = 0; i < n; i += 4) {
      out[i] = lr[src[i]];
      out[i + 1] = lg[src[i + 1]];
      out[i + 2] = lb[src[i + 2]];
      out[i + 3] = src[i + 3];
    }
    return out;
  }
  for (let i = 0; i < n; i += 4) {
    const r = lr[src[i]];
    const g = lg[src[i + 1]];
    const b = lb[src[i + 2]];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    out[i] = l + (r - l) * sat;
    out[i + 1] = l + (g - l) * sat;
    out[i + 2] = l + (b - l) * sat;
    out[i + 3] = src[i + 3];
  }
  return out;
}

// Правки фото → пиксели (свет и цвет; местные правки ops добавит S03c)
export function applyEdits(src, out, edits) {
  return applyParams(src, out, effectiveParams(edits));
}

// Сложить шаг (команда или ползунок) с ручными правками
export function addManual(edits, deltas, by = "command") {
  const ed = normEdits(edits);
  const manual = { ...ed.manual };
  for (const [k, d] of Object.entries(deltas)) {
    if (!ADJUST_KEYS.includes(k)) continue;
    manual[k] = round(clamp((Number(manual[k]) || 0) + d, -LIMIT, LIMIT));
    if (Math.abs(manual[k]) < 0.5) delete manual[k];
  }
  return { ...ed, manual, by };
}

export function setManual(edits, key, value, by = "slider") {
  const ed = normEdits(edits);
  const manual = { ...ed.manual, [key]: round(clamp(Number(value) || 0, -LIMIT, LIMIT)) };
  if (Math.abs(manual[key]) < 0.5) delete manual[key];
  return { ...ed, manual, by };
}
