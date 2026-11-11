"use client";
import Link from "next/link";
import { deleteDraft, useDraft } from "../../lib/draft";
import { useProduct } from "../../lib/useCatalog";

export default function BooksPage() {
  const { ready, draft, thumbs } = useDraft();
  const { product } = useProduct(draft?.productSlug);
  if (!ready) return <p className="muted">Загружаем…</p>;
  return (
    <div>
      <h1>Мои книги и фото</h1>
      {!draft || !product ? (
        <div className="card">
          <p>Черновиков пока нет.</p>
          <p className="muted">Соберите книгу — история семьи, путешествие или просто тёплые дни.</p>
          <Link href="/" className="btn btn-primary">В каталог</Link>
        </div>
      ) : (
        <div className="card">
          <b style={{ color: "var(--ds-color-text-strong)" }}>{product.kind === "book" ? "Фотокнига " : ""}{product.name}</b>
          <div className="muted small">
            Черновик · {draft.photos.length} фото · изменён {new Date(draft.updatedAt).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
          </div>
          <div className="photo-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 4, margin: "12px 0" }}>
            {draft.photos.slice(0, 6).map((p) => (
              <div key={p.id} className="photo-cell">{thumbs[p.id] && <img src={thumbs[p.id]} alt="" />}</div>
            ))}
          </div>
          <div className="row wrap">
            <Link href="/editor" className="btn btn-small btn-primary">Продолжить</Link>
            <button className="btn btn-small" onClick={() => { if (window.confirm("Удалить черновик и его фото с этого устройства?")) deleteDraft(); }}>Удалить</button>
          </div>
        </div>
      )}
    </div>
  );
}
