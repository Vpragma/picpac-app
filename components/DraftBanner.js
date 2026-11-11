"use client";
import Link from "next/link";
import { useDraft } from "../lib/draft";
import { useProduct } from "../lib/useCatalog";

// Плашка «Продолжить черновик»
export default function DraftBanner() {
  const { ready, draft } = useDraft();
  const { product: p } = useProduct(draft?.productSlug);
  if (!ready || !draft) return null;
  if (!p) return null;
  return (
    <Link href="/editor" className="card row between" style={{ textDecoration: "none", color: "inherit", background: "var(--ds-gradient-selected)" }}>
      <div>
        <b style={{ color: "var(--ds-color-text-strong)" }}>Продолжить черновик</b>
        <div className="muted small">
          {p.name} · {draft.photos.length} фото
        </div>
      </div>
      <span className="btn btn-small btn-primary">Открыть</span>
    </Link>
  );
}
