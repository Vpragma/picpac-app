"use client";
import Link from "next/link";
import { useCatalog } from "../lib/useCatalog";
import { money } from "../lib/price";
import { plural } from "../lib/plural";
import { IconBook, IconImage } from "./icons";
import DraftBanner from "./DraftBanner";

// Каталог. initial — каталог, полученный на сервере (SSR): тогда браузер его не запрашивает.
// covers — фото-обложки карточек с сервера ({ slug: <picture> }); без них — значок, как раньше
export default function CatalogView({ initial, covers = {} }) {
  const { data, error, loading, retry } = useCatalog(initial);
  return (
    <div>
      <h1>Что напечатать?</h1>
      <p className="muted">Цена видна сразу. Фотокниги печатаем за 3 дня, фото — за 2 дня.</p>
      <DraftBanner />
      {loading && <p className="muted">Загружаем каталог…</p>}
      {error && (
        <div className="card">
          <b className="err-text">Не удалось загрузить каталог.</b>
          <p className="muted">Проверьте интернет и попробуйте ещё раз.</p>
          <button className="btn btn-primary" onClick={retry}>
            Повторить
          </button>
        </div>
      )}
      {data && (
        <>
          <h2 style={{ marginTop: 16 }}>Фотокниги</h2>
          <div className="catalog-grid">
            {data.products.filter((p) => p.kind === "book").map((p) => (
              <ProductCard key={p.slug} p={p} cover={covers[p.slug]} />
            ))}
          </div>
          <h2 style={{ marginTop: 16 }}>Нужны просто фотографии?</h2>
          <div className="catalog-grid">
            {data.products.filter((p) => p.kind === "print").map((p) => (
              <ProductCard key={p.slug} p={p} cover={covers[p.slug]} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ProductCard({ p, cover }) {
  const isBook = p.kind === "book";
  const sizes = p.sizes.map((s) => s.id.replace("x", "×")).join(", ");
  return (
    <Link href={"/product/" + p.slug} className="card product-card">
      <div className={"product-cover" + (isBook ? " book" : "") + (cover ? " has-photo" : "")}>
        {cover || (isBook ? <IconBook size={44} /> : <IconImage size={44} />)}
      </div>
      <div className="row between">
        <h3 className="card-title">{p.name}</h3>
        {p.badge && <span className="chip chip-hl">{p.badge}</span>}
      </div>
      <p className="muted" style={{ margin: "4px 0 8px" }}>{p.tagline}</p>
      <div className="row between">
        <span className="muted small">{isBook ? `от ${p.pages.min} ${plural(p.pages.min, ["страницы", "страниц", "страниц"])} · ${sizes} см` : `от 1 штуки · ${sizes} см`}</span>
        <b style={{ color: "var(--ds-color-text-strong)", whiteSpace: "nowrap" }}>
          от {money(p.priceFrom)}
          {isBook ? "" : " за фото"}
        </b>
      </div>
    </Link>
  );
}
