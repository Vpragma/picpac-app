"use client";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import { useProduct } from "../../../lib/useCatalog";
import { bookPrice, deliveryRange, money, pagesForPhotos, photoHint } from "../../../lib/price";
import { startDraft } from "../../../lib/draft";
import { notify } from "../../../lib/store";

export default function ProductPage() {
  const { slug } = useParams();
  const { product, loading, error, retry } = useProduct(slug);
  if (loading) return <p className="muted">Загружаем…</p>;
  if (error)
    return (
      <div className="card">
        <b className="err-text">Не удалось загрузить продукт.</b>
        <p className="muted">Проверьте интернет и попробуйте ещё раз.</p>
        <button className="btn btn-primary" onClick={retry}>
          Повторить
        </button>
      </div>
    );
  if (!product)
    return (
      <div className="card">
        <h2>Такого продукта нет</h2>
        <Link href="/">Вернуться в каталог</Link>
      </div>
    );
  return <ProductForm key={product.slug} product={product} />;
}

function ProductForm({ product: p }) {
  const router = useRouter();
  const isBook = p.kind === "book";
  const [sizeId, setSizeId] = useState(p.sizes[0].id);
  const options = isBook ? p.covers : p.surfaces;
  const [optionId, setOptionId] = useState(options[0].id);
  const [pages, setPages] = useState(isBook ? p.pages.min : 0);
  const [photoCount, setPhotoCount] = useState("");
  const [busy, setBusy] = useState(false);

  const size = p.sizes.find((s) => s.id === sizeId);
  const price = isBook ? bookPrice(p, pages) : size.unitPrice;
  const step = (d) => setPages((n) => Math.min(p.pages.max, Math.max(p.pages.min, n + d)));

  async function create() {
    setBusy(true);
    let ok = false;
    try {
      await startDraft({ productSlug: p.slug, sizeId, optionId, pages });
      ok = true;
    } catch (e) {
      console.error(e);
      notify("Не получилось открыть черновик. Попробуйте ещё раз.", "error");
    } finally {
      setBusy(false);
    }
    if (ok) router.push("/editor");
  }

  return (
    <div className="has-sticky">
      <Link href="/" className="back-link">
        ← Каталог
      </Link>
      <h1 style={{ marginTop: 8 }}>
        {isBook ? "Фотокнига " : ""}
        {p.name}
      </h1>
      <p className="muted">{p.tagline}</p>
      <p>{p.description}</p>

      <section className="card">
        <h3>Размер</h3>
        <div className="options">
          {p.sizes.map((s) => (
            <button key={s.id} className={"option" + (s.id === sizeId ? " selected" : "")} onClick={() => setSizeId(s.id)} aria-pressed={s.id === sizeId}>
              <b>{s.id.replace("x", "×")} см</b>
              <span>
                {s.label}
                {!isBook && " · " + money(s.unitPrice)}
              </span>
            </button>
          ))}
        </div>
        {isBook && sizeId !== p.price.basedOnSize && (
          <p className="muted small" style={{ marginTop: 8 }}>
            Цена указана для 20×20 см — цены других размеров уточняем.
          </p>
        )}
      </section>

      <section className="card">
        <h3>{isBook ? "Обложка" : "Поверхность"}</h3>
        {options.length === 1 && <p className="muted small">Для {p.name} доступен один вариант.</p>}
        <div className="options">
          {options.map((o) => (
            <button key={o.id} className={"option" + (o.id === optionId ? " selected" : "")} onClick={() => setOptionId(o.id)} aria-pressed={o.id === optionId}>
              <b>{o.label}</b>
              <span>{o.note}</span>
            </button>
          ))}
        </div>
      </section>

      {isBook ? (
        <section className="card">
          <h3>Страниц</h3>
          <div className="row between">
            <div className="stepper">
              <button className="icon-btn" onClick={() => step(-2)} disabled={pages <= p.pages.min} aria-label="Меньше страниц">
                −
              </button>
              <output aria-live="polite">{pages}</output>
              <button className="icon-btn" onClick={() => step(2)} disabled={pages >= p.pages.max} aria-label="Больше страниц">
                +
              </button>
            </div>
            <span className="muted small">
              от {p.pages.min} до {p.pages.max}, шаг 2
            </span>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>{photoHint(pages)}</p>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" style={{ maxWidth: 140 }} inputMode="numeric" placeholder="Число фото" value={photoCount} onChange={(e) => setPhotoCount(e.target.value.replace(/\D/g, ""))} aria-label="Сколько у вас фото" />
            <button className="btn btn-small" disabled={!photoCount} onClick={() => setPages(pagesForPhotos(p, Number(photoCount)))}>
              Подобрать по числу фото
            </button>
          </div>
        </section>
      ) : (
        <section className="card">
          <h3>Сколько фото</h3>
          <p className="muted">Заказ от 1 штуки. Точная сумма — после загрузки фото.</p>
        </section>
      )}

      <section className="card">
        <div className="row between">
          <span>Итого</span>
          <span className="price">
            {!isBook && <span className="muted small">за фото </span>}
            {money(price)}
          </span>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Напечатаем за {p.printDays} {p.printDays === 2 ? "дня" : "дня"} — доставим ориентировочно {deliveryRange(p.printDays)}.
        </p>
        <p className="muted small">Платить сейчас не нужно. Брак — перепечатаем бесплатно.</p>
      </section>

      <div className="sticky-bar">
        <div>
          <div className="muted small">{isBook ? `${pages} стр. · ${sizeId.replace("x", "×")}` : `${sizeId.replace("x", "×")} · за фото`}</div>
          <b style={{ fontSize: 20, color: "var(--ds-color-text-strong)" }}>{money(price)}</b>
        </div>
        <button className="btn btn-primary" onClick={create} disabled={busy}>
          {isBook ? "Создать фотокнигу" : "Выбрать фото"}
        </button>
      </div>
    </div>
  );
}
