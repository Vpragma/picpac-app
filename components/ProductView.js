"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { track } from "../lib/analytics";
import Link from "next/link";
import { useProduct } from "../lib/useCatalog";
import { pagesForPhotos, photoHint } from "../lib/price";
import { daysWord, etaFromDay, formatByn, formatEtaRange, linePrice, minskDate } from "../lib/pricing";
import { plural } from "../lib/plural";
import { createProject } from "../lib/draft";
import { notify } from "../lib/store";
import { OPENS_FLAT, tagClass } from "./CatalogView";

// Группы опций из каталога — в таком порядке и с такими подписями
const GROUPS = [
  ["cover", "Обложка"],
  ["lamination", "Ламинация страниц"],
  ["paper", "Бумага"],
  ["print", "Тип печати"],
  ["surface", "Поверхность"],
];

// gallery — фото продукта, собранные на сервере (app/product/[slug]/page.js), без клиентского JS
export default function ProductView({ slug, initial, serverToday, gallery = null }) {
  useEffect(() => {
    if (slug) track("product_view", { props: /^[a-z0-9-]{1,40}$/.test(slug) ? { product: slug } : undefined });
  }, [slug]);
  const { product, catalog, loading, error, retry } = useProduct(slug, initial);
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
  return <ProductForm key={product.slug} product={product} delivery={catalog?.delivery || []} serverToday={serverToday} gallery={gallery} />;
}

// Сегодняшняя дата по Минску. На сервере — дата отрисовки страницы, в браузере — текущая (без ошибки гидратации).
const noSubscribe = () => () => {};
function useMinskToday(serverToday) {
  return useSyncExternalStore(noSubscribe, () => minskDate(), () => serverToday || minskDate());
}

function defaultOptions(p) {
  const out = {};
  for (const [group, list] of Object.entries(p.options || {})) out[group] = (list.find((x) => x.default) || list[0]).id;
  // Ламинация страниц по умолчанию — как обложка (superpicpac.md)
  if (p.options?.lamination?.some((x) => x.id === out.cover)) out.lamination = out.cover;
  return out;
}

// «Для фотокниги Lite…», «Для цифровой печати…» — название в родительном падеже
const PRINT_GENITIVE = { photo: "печати фото", digital: "цифровой печати" };
function forName(p) {
  if (p.kind === "book") return `фотокниги ${p.name}`;
  return PRINT_GENITIVE[p.slug] || "этого продукта";
}

function ProductForm({ product: p, delivery, serverToday, gallery }) {
  const router = useRouter();
  const isBook = p.kind === "book";
  const [sizeId, setSizeId] = useState(p.sizes[0].id);
  const [opts, setOpts] = useState(() => defaultOptions(p));
  const [lamTouched, setLamTouched] = useState(false);
  const [pages, setPages] = useState(isBook ? p.pages.min : 0);
  const [quantity, setQuantity] = useState(1);
  const [photoCount, setPhotoCount] = useState("");
  const [busy, setBusy] = useState(false);
  const today = useMinskToday(serverToday);

  const priceFor = (size) => linePrice(p, { sizeCode: size, pages, photoCount: 1, quantity: 1, options: opts })?.unitKop ?? 0;
  const unitKop = priceFor(sizeId);
  const totalKop = unitKop * quantity;
  const size = p.sizes.find((s) => s.id === sizeId);
  const step = (d) => setPages((n) => Math.min(p.pages.max, Math.max(p.pages.min, n + d)));

  function pick(group, id) {
    setOpts((o) => {
      const next = { ...o, [group]: id };
      // Пока ламинацию не меняли руками — она следует за обложкой
      if (group === "cover" && !lamTouched && p.options?.lamination?.some((x) => x.id === id)) next.lamination = id;
      return next;
    });
    if (group === "lamination") setLamTouched(true);
  }

  // Сроки по Минску: печать + доставка выбранного способа
  const etas = delivery.map((d) => ({ ...d, range: formatEtaRange(...Object.values(etaFromDay(today, p.printDays, d.minDays, d.maxDays))) }));
  const main = etas[0];

  // Сколько точек нужно фото на всю страницу (книга) или на весь отпечаток
  const longCm = Math.max(size.w, size.h);
  const px = (dpi) => Math.round((longCm / 2.54) * dpi);

  async function create() {
    setBusy(true);
    let project = null;
    try {
      project = await createProject({ productSlug: p.slug, sizeId, options: opts, pages, quantity });
    } catch (e) {
      console.error(e);
      notify("Не получилось открыть черновик. Попробуйте ещё раз.", "error");
    } finally {
      setBusy(false);
    }
    if (project) router.push("/editor");
  }

  return (
    <div className="has-sticky product-page">
      {/* D2: на компьютере — две колонки: параметры слева, итог и кнопка справа (липкие) */}
      <div className="product-main">
        <Link href="/" className="back-link">
          ← Каталог
        </Link>
        <div className="product-head" style={{ marginTop: 8 }}>
          <h1>
            {isBook ? "Фотокнига " : ""}
            {p.name}
          </h1>
          {(p.badge || OPENS_FLAT.has(p.slug)) && (
            <span className="tags">
              {p.badge && <span className={tagClass(p.badge)}>{p.badge}</span>}
              {OPENS_FLAT.has(p.slug) && <span className="tag tag-180">раскрытие 180°</span>}
            </span>
          )}
        </div>
        <p className="muted" style={{ marginTop: 4 }}>{p.tagline}</p>
        {gallery}
        <p>{p.description}</p>

        <section className="card">
          <h3>Размер</h3>
          <div className="options">
            {p.sizes.map((s) => (
              <button key={s.id} className={"option" + (s.id === sizeId ? " selected" : "")} onClick={() => setSizeId(s.id)} aria-pressed={s.id === sizeId}>
                <b>{s.id.replace("x", "×")} см</b>
                <span>
                  {s.label} · {formatByn(priceFor(s.id))}
                  {isBook ? "" : " за фото"}
                </span>
              </button>
            ))}
          </div>
        </section>

        {GROUPS.filter(([g]) => p.options?.[g]?.length).map(([group, title]) => {
          const list = p.options[group];
          return (
            <section className="card" key={group}>
              <h3>{title}</h3>
              {list.length === 1 && <p className="muted small">Для {forName(p)} доступен один вариант.</p>}
              <div className="options">
                {list.map((o) => (
                  <button key={o.id} className={"option" + (o.id === opts[group] ? " selected" : "")} onClick={() => pick(group, o.id)} aria-pressed={o.id === opts[group]}>
                    <b>{o.label}</b>
                    <span>
                      {o.note}
                      {o.priceDeltaKop ? ` · +${formatByn(o.priceDeltaKop)}` : " · без доплаты"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {isBook && (
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
              <input className="input" style={{ maxWidth: 140 }} inputMode="numeric" placeholder="Число фото" value={photoCount} onChange={(e) => setPhotoCount(e.target.value.replace(/\D/g, "").slice(0, 4))} aria-label="Сколько у вас фото" />
              <button className="btn btn-small" disabled={!photoCount} onClick={() => setPages(pagesForPhotos(p, Number(photoCount)))}>
                Подобрать по числу фото
              </button>
            </div>
          </section>
        )}

        <section className="card">
          <h3>{isBook ? "Сколько экземпляров" : "Копий каждого фото"}</h3>
          <div className="row between">
            <div className="stepper">
              <button className="icon-btn" onClick={() => setQuantity((n) => Math.max(1, n - 1))} disabled={quantity <= 1} aria-label="Меньше">
                −
              </button>
              <output aria-live="polite">{quantity}</output>
              <button className="icon-btn" onClick={() => setQuantity((n) => Math.min(50, n + 1))} disabled={quantity >= 50} aria-label="Больше">
                +
              </button>
            </div>
            <span className="muted small">{isBook ? "одинаковые книги" : "число фото выберете в редакторе"}</span>
          </div>
        </section>

        <section className="card">
          <h3>Требования к фото</h3>
          <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            <li>JPEG или PNG, до {Math.round((p.requirements?.maxBytes || 25 * 1048576) / 1048576)} МБ за файл. HEIC (iPhone), WebP и GIF сначала сохраните как JPEG.</li>
            <li>
              Для чёткой печати {size.id.replace("x", "×")} см {isBook ? "на всю страницу" : ""} — от {px(150)} {plural(px(150), ["точки", "точек", "точек"])} по длинной стороне, лучше {px(300)}. Меньше {px(100)} — будет размыто.
            </li>
            <li>Берите оригиналы из галереи телефона, а не из мессенджеров: там фото сжаты.</li>
          </ul>
        </section>
      </div>

      <aside className="product-aside" aria-label="Итого и сроки">
        <section className="card">
          <div className="row between">
            <span>Итого{quantity > 1 ? ` за ${quantity} ${isBook ? "экз." : plural(quantity, ["копию", "копии", "копий"])}` : ""}</span>
            <span className="price">
              {!isBook && <span className="muted small">за фото </span>}
              {formatByn(totalKop)}
            </span>
          </div>
          {main && (
            <p style={{ marginTop: 4 }}>
              Напечатаем за {daysWord(p.printDays)} — доставим ориентировочно <b>{main.range}</b>
              <span className="muted"> ({main.name.toLowerCase().startsWith("европочта") ? "в пункт Европочты" : main.name})</span>.
            </p>
          )}
          {etas.length > 1 && (
            <details className="small" style={{ marginTop: 4 }}>
              <summary>Сроки и цена других способов доставки</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                {etas.map((d) => (
                  <li key={d.code}>
                    {d.name}: {d.range}, {formatByn(d.priceKop)}
                    {d.freeFromKop != null ? `, бесплатно от ${formatByn(d.freeFromKop)}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="muted small" style={{ marginTop: 4 }}>Сроки по Минску. Платить сейчас не нужно. Брак — перепечатаем бесплатно.</p>
        </section>

        <div className="sticky-bar">
          <div>
            <div className="muted small">{isBook ? `${pages} стр. · ${sizeId.replace("x", "×")}${quantity > 1 ? ` · ${quantity} экз.` : ""}` : `${sizeId.replace("x", "×")} · за фото${quantity > 1 ? ` × ${quantity}` : ""}`}</div>
            <b className="sum-strong">{formatByn(totalKop)}</b>
          </div>
          <button className="btn btn-primary" onClick={create} disabled={busy}>
            {isBook ? "Создать фотокнигу" : "Выбрать фото"}
          </button>
        </div>
      </aside>
    </div>
  );
}
