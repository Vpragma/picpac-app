// Скелетон списка (N2): серые карточки с мерцанием, пока данные загружаются. Для экранного диктора — текст label.
// Мерцание — только transform (app/motion.css); при prefers-reduced-motion — без движения.
export function SkeletonList({ rows = 3, label = "Загружаем…" }) {
  return (
    <div className="skeleton-list" role="status" data-testid="skeleton">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-card" aria-hidden="true">
          <span className="skeleton skeleton-thumb" />
          <span className="skeleton-lines">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line short" />
          </span>
        </div>
      ))}
    </div>
  );
}
