"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { openProject, useDraft } from "../lib/draft";
import { useProduct } from "../lib/useCatalog";

const HIDE_KEY = "picpac:continue-hidden";

// Плашка «Продолжить «Название»?» (W-13): последний изменённый незаказанный проект.
// Без давления: «×» скрывает её до конца сеанса (sessionStorage).
export default function DraftBanner() {
  const router = useRouter();
  const { ready, projects } = useDraft();
  // Пока черновики не прочитаны (и при отрисовке на сервере), плашки нет — значит, чтение sessionStorage здесь безопасно
  const [hidden, setHidden] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(HIDE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const last = Object.values(projects || {})
    .filter((p) => p.status !== "ordered")
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const { product: p } = useProduct(last?.productSlug);
  if (!ready || !last || !p || hidden) return null;
  const name = (last.title || "").trim() || p.name;
  async function open() {
    await openProject(last.id);
    router.push("/editor");
  }
  function hide() {
    try {
      sessionStorage.setItem(HIDE_KEY, "1");
    } catch {}
    setHidden(true);
  }
  return (
    <div className="card row between" style={{ gap: 8, background: "var(--ds-gradient-selected)" }}>
      <button onClick={open} className="row between" style={{ flex: 1, minWidth: 0, textAlign: "left", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "inherit", background: "none" }}>
        <span style={{ minWidth: 0 }}>
          <b style={{ color: "var(--ds-color-text-strong)", display: "block", overflowWrap: "anywhere" }}>Продолжить «{name.length > 60 ? name.slice(0, 60) + "…" : name}»?</b>
          <span className="muted small" style={{ display: "block" }}>
            {p.name} · {last.photos.length} фото{last.status === "in_cart" ? " · в корзине" : ""}
          </span>
        </span>
        <span className="btn btn-small btn-primary">Продолжить</span>
      </button>
      <button type="button" className="icon-btn" onClick={hide} aria-label="Скрыть до следующего раза" title="Скрыть">
        ×
      </button>
    </div>
  );
}
