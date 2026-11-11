"use client";
import { useRouter } from "next/navigation";
import { openProject, useDraft } from "../lib/draft";
import { useProduct } from "../lib/useCatalog";

// Плашка «Продолжить черновик»: последний изменённый незаказанный проект
export default function DraftBanner() {
  const router = useRouter();
  const { ready, projects } = useDraft();
  const last = Object.values(projects || {})
    .filter((p) => p.status !== "ordered")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const { product: p } = useProduct(last?.productSlug);
  if (!ready || !last || !p) return null;
  async function open() {
    await openProject(last.id);
    router.push("/editor");
  }
  return (
    <button onClick={open} className="card row between" style={{ width: "100%", textAlign: "left", border: 0, cursor: "pointer", font: "inherit", color: "inherit", background: "var(--ds-gradient-selected)" }}>
      <span>
        <b style={{ color: "var(--ds-color-text-strong)" }}>Продолжить {last.status === "in_cart" ? "проект из корзины" : "черновик"}</b>
        <span className="muted small" style={{ display: "block" }}>
          {p.name} · {last.photos.length} фото
        </span>
      </span>
      <span className="btn btn-small btn-primary">Открыть</span>
    </button>
  );
}
