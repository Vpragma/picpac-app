// Значки на миниатюрах: проблемы из анализатора (photo.quality), печатное разрешение и правки
import { hasAuto, hasManual } from "./edits";

const LABELS = { dark: "Темно", bright: "Пересвет", blurry: "Размыто", cast: "Оттенок" };

// lowDpi — фото с предупреждением о резкости в печати (из lib/checks.js, как в «Проверке»)
export function photoBadges(photo, { lowDpi = false, duplicate = false } = {}) {
  const out = [];
  for (const id of photo?.quality?.problems || []) if (LABELS[id]) out.push({ id, label: LABELS[id], tone: "warn" });
  if (duplicate) out.push({ id: "dup", label: "Похоже на дубль", short: "Дубль", tone: "warn" });
  if (lowDpi) out.push({ id: "dpi", label: "Мало точек для печати", short: "Мало точек", tone: "warn" });
  // W-15: фото с флагом цензуры (оценки nsfwjs на устройстве) проверит модератор — нейтральный значок, не ошибка
  if (photo?.moderationFlag) out.push({ id: "mod", label: "Проверит модератор", short: "Модератор", tone: "ok" });
  if (hasAuto(photo?.edits)) out.push({ id: "auto", label: "Улучшено", tone: "ok" });
  if (hasManual(photo?.edits)) out.push({ id: "ai", label: "ИИ", tone: "ai" });
  return out;
}
