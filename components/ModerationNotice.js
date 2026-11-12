"use client";
// Плашка W-15: фото, которые классификатор на устройстве пометил как подозрительные, проверит модератор.
// Нейтрально (не ошибка): заказ можно оформить, печать начнётся после проверки. Автоматика никогда не отклоняет.
export default function ModerationNotice({ count = 0, compact = false }) {
  if (!count) return null;
  return (
    <div className="card" role="status" data-testid="moderation-notice" style={{ background: "var(--ds-color-info-bg)", margin: compact ? "8px 0" : undefined }}>
      <b>Это фото проверит модератор.</b>{" "}
      {count > 1 ? `Фото на проверке: ${count}. ` : ""}
      Обычно это занимает до 1 часа. Оформить заказ можно — печать начнётся после проверки.
    </div>
  );
}

// Сколько фото проекта ждут модератора (флаг ставит сервер по оценкам с устройства)
export const flaggedCount = (photos) => (photos || []).filter((p) => p?.moderationFlag).length;
