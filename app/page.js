"use client";
import Link from "next/link";
import { useCatalog } from "../lib/useCatalog";
import { bookPrice, money } from "../lib/price";
import { IconBook, IconImage } from "../components/icons";
import DraftBanner from "../components/DraftBanner";

function fromPrice(p) {
  if (p.kind === "book") return bookPrice(p, p.pages.min);
  return Math.min(...p.sizes.map((s) => s.unitPrice));
}

export default function CatalogPage() {
  const { data, error, loading } = useCatalog();
  return (
    <div>
      <h1>Что напечатать?</h1>
      <p className="muted">Цена видна сразу. Фотокниги печатаем за 3 дня, фото — за 2 дня.</p>
      <DraftBanner />
      {loading && <p className="muted">Загружаем каталог…</p>}
      {error && (
        <div className="card">
          <b className="err-text">Не удалось загрузить каталог.</b>
          <p className="muted">Проверьте интернет и обновите страницу.</p>
        </div>
      )}
      {data && (
        <>
          <h2 style={{ marginTop: 16 }}>Фотокниги</h2>
          {data.products.filter((p) => p.kind === "book").map((p) => (
            <ProductCard key={p.slug} p={p} />
          ))}
          <h2 style={{ marginTop: 16 }}>Нужны просто фотографии?</h2>
          {data.products.filter((p) => p.kind === "print").map((p) => (
            <ProductCard key={p.slug} p={p} />
          ))}
        </>
      )}
    </div>
  );
}

function ProductCard({ p }) {
  const isBook = p.kind === "book";
  return (
    <Link href={"/product/" + p.slug} className="card product-card">
      <div className={"product-cover" + (isBook ? " book" : "")}>
        {isBook ? <IconBook size={44} /> : <IconImage size={44} />}
      </div>
      <div className="row between">
        <h3 style={{ margin: 0, fontSize: 22 }}>{p.name}</h3>
        {p.badge && <span className="chip chip-hl">{p.badge}</span>}
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>{p.tagline}</p>
      <div className="row between">
        <span className="muted small">
          {isBook ? `от ${p.pages.min} страниц · ${p.sizes.map((s) => s.id.replace("x", "×")).join(", ")} см` : `от 1 штуки · ${p.sizes.map((s) => s.id.replace("x", "×")).join(", ")} см`}
        </span>
        <b style={{ color: "var(--ds-color-text-strong)", whiteSpace: "nowrap" }}>от {money(fromPrice(p))}</b>
      </div>
    </Link>
  );
}
