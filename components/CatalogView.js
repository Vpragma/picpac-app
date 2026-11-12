"use client";
import Link from "next/link";
import { useCatalog } from "../lib/useCatalog";
import { money } from "../lib/price";
import { plural } from "../lib/plural";
import { IconBook, IconImage } from "./icons";
import DraftBanner from "./DraftBanner";

// Плашки на карточках (брендбук): «новинка», «скидка», «выбор pic pac» — текст из каталога (products.badge)
export function tagClass(badge = "") {
  const b = badge.toLowerCase();
  if (b.includes("нов")) return "tag tag-new";
  if (b.includes("скид") || /^[−-]\s?\d/.test(b)) return "tag tag-sale";
  if (b.includes("выбор")) return "tag tag-choice";
  return "tag";
}

// Значок «180°» брендбука — книга раскрывается на 180° (Classic, slug layflat)
export const OPENS_FLAT = new Set(["layflat"]);

// Цена «от …»: если в каталоге есть старая цена (oldPriceFrom) — она зачёркнута рядом с новой
export function PriceFrom({ p, suffix = "" }) {
  const old = p.oldPriceFrom && p.oldPriceFrom > p.priceFrom ? p.oldPriceFrom : null;
  return (
    <span className="price-row">
      {old && (
        <s className="price-old">
          <span className="visually-hidden">Было </span>
          {money(old)}
        </s>
      )}
      <span className="price-now">
        {old && <span className="visually-hidden">Сейчас </span>}
        от {money(p.priceFrom)}
      </span>
      {suffix && <span className="price-unit">{suffix}</span>}
    </span>
  );
}

// Каталог. initial — каталог, полученный на сервере (SSR): тогда браузер его не запрашивает.
// covers — фото-обложки карточек с сервера ({ slug: <picture> }); без них — значок, как раньше
export default function CatalogView({ initial, covers = {} }) {
  const { data, error, loading, retry } = useCatalog(initial);
  return (
    <section className="section" id="catalog" aria-labelledby="catalog-title" style={{ scrollMarginTop: 80 }}>
      <div className="section-head">
        <div>
          <p className="eyebrow">Каталог</p>
          <h2 id="catalog-title">Что напечатать?</h2>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>Цена видна сразу. Фотокниги печатаем за 3 дня, фото — за 2 дня.</p>
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
          <h3 className="catalog-sub">Фотокниги</h3>
          <div className="catalog-grid">
            {data.products.filter((p) => p.kind === "book").map((p) => (
              <ProductCard key={p.slug} p={p} cover={covers[p.slug]} />
            ))}
          </div>
          <h3 className="catalog-sub">Нужны просто фотографии?</h3>
          <div className="catalog-grid">
            {data.products.filter((p) => p.kind === "print").map((p) => (
              <ProductCard key={p.slug} p={p} cover={covers[p.slug]} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function ProductCard({ p, cover }) {
  const isBook = p.kind === "book";
  const sizes = p.sizes.map((s) => s.id.replace("x", "×")).join(", ");
  return (
    <Link href={"/product/" + p.slug} className="card product-card">
      <div className={"product-cover" + (isBook ? " book" : "") + (cover ? " has-photo" : "")}>
        {cover || (isBook ? <IconBook size={44} /> : <IconImage size={44} />)}
        {(p.badge || OPENS_FLAT.has(p.slug)) && (
          <span className="tags tags-over">
            {p.badge && <span className={tagClass(p.badge)}>{p.badge}</span>}
            {OPENS_FLAT.has(p.slug) && (
              <span className="tag tag-180" title="Раскрывается на 180°">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 17c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0M12 17V7M3 17V8c3-1.5 6-1.5 9-1 3-.5 6-.5 9 1v9" />
                </svg>
                180°
              </span>
            )}
          </span>
        )}
      </div>
      <div className="product-body">
        <h3 className="card-title">{p.name}</h3>
        <p className="muted" style={{ margin: 0 }}>{p.tagline}</p>
        <span className="product-meta">{isBook ? `от ${p.pages.min} ${plural(p.pages.min, ["страницы", "страниц", "страниц"])} · ${sizes} см` : `от 1 штуки · ${sizes} см`}</span>
        <div className="product-foot">
          <PriceFrom p={p} suffix={isBook ? "" : "за фото"} />
          <span className="go-arrow" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
      </div>
    </Link>
  );
}
