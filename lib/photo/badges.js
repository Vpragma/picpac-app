// Значки на миниатюрах: проблемы из анализатора (photo.quality), печатное разрешение и правки
import { hasAuto, hasManual } from "./edits";

const LABELS = { dark: "Темно", bright: "Пересвет", blurry: "Размыто", cast: "Оттенок" };

// lowDpi — фото с предупреждением о резкости в печати (из lib/checks.js, как в «Проверке»)
export function photoBadges(photo, { lowDpi = false } = {}) {
  const out = [];
  for (const id of photo?.quality?.problems || []) if (LABELS[id]) out.push({ id, label: LABELS[id], tone: "warn" });
  if (lowDpi) out.push({ id: "dpi", label: "Мало точек для печати", short: "Мало точек", tone: "warn" });
  if (hasAuto(photo?.edits)) out.push({ id: "auto", label: "Улучшено", tone: "ok" });
  if (hasManual(photo?.edits)) out.push({ id: "ai", label: "ИИ", tone: "ai" });
  return out;
}
