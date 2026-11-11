"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { addFiles, movePhoto, removePhoto, replacePhoto, updateDraft, useDraft } from "../../lib/draft";
import { useProduct } from "../../lib/useCatalog";
import { bookPrice, deliveryRange, money, photoHint, printPrice } from "../../lib/price";
import { runChecks } from "../../lib/checks";
import { readKey, writeKey, notify } from "../../lib/store";
import { IconAlert, IconCheck, IconLeft, IconRight, IconTrash, IconUpload } from "../../components/icons";

const STEPS = [
  { id: "photos", label: "1. Фото" },
  { id: "layout", label: "2. Макет" },
  { id: "check", label: "3. Проверка" },
];

export default function EditorPage() {
  const { ready, draft, thumbs } = useDraft();
  const { product, loading } = useProduct(draft?.productSlug);
  const [step, setStep] = useState("photos");

  if (!ready || (draft && loading)) return <p className="muted">Открываем черновик…</p>;
  if (!draft || !product)
    return (
      <div className="card">
        <h2>Черновика пока нет</h2>
        <p className="muted">Выберите фотокнигу или печать фото в каталоге — и начнём.</p>
        <Link href="/" className="btn btn-primary">
          В каталог
        </Link>
      </div>
    );

  const isBook = product.kind === "book";
  const usable = draft.photos.filter((p) => p.supported).length;
  const price = isBook ? bookPrice(product, draft.pages) : printPrice(product, draft.sizeId, usable);

  return (
    <div className="has-sticky">
      <div className="card" style={{ padding: 12 }}>
        <div className="row between">
          <div>
            <b style={{ color: "var(--ds-color-text-strong)" }}>
              {isBook ? "Фотокнига " : ""}
              {product.name}
            </b>
            <div className="muted small">
              {draft.sizeId.replace("x", "×")} см
              {isBook ? ` · ${draft.pages} стр. · ${photoHint(draft.pages)}` : ` · ${usable} фото`}
            </div>
          </div>
          <Link href={"/product/" + product.slug} className="btn btn-small">
            Изменить
          </Link>
        </div>
      </div>
      <div className="steps" role="tablist">
        {STEPS.map((s) => (
          <button key={s.id} role="tab" aria-selected={step === s.id} className={step === s.id ? "active" : ""} onClick={() => setStep(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {step === "photos" && <PhotosStep draft={draft} thumbs={thumbs} product={product} />}
      {step === "layout" && <LayoutStep draft={draft} thumbs={thumbs} product={product} />}
      {step === "check" && <CheckStep draft={draft} thumbs={thumbs} product={product} price={price} goPhotos={() => setStep("photos")} />}

      <div className="sticky-bar">
        <div>
          <div className="muted small">{isBook ? "Цена книги" : `${usable} × ${money(product.sizes.find((s) => s.id === draft.sizeId).unitPrice)}`}</div>
          <b style={{ fontSize: 20, color: "var(--ds-color-text-strong)" }}>{money(price)}</b>
        </div>
        {step !== "check" ? (
          <button className="btn btn-primary" onClick={() => setStep(step === "photos" ? "layout" : "check")} disabled={!draft.photos.length}>
            Дальше
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Шаг 1: фото ---------- */
function useAdder() {
  const [busy, setBusy] = useState(false);
  async function add(files) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const { added, rejected } = await addFiles(files);
      if (added) notify(`Добавлено фото: ${added}`, "success");
      if (rejected.length) notify(`Это не фото, пропустили: ${rejected.join(", ")}`, "error");
    } catch (e) {
      console.error(e);
      notify("Не удалось добавить фото. Попробуйте ещё раз.", "error");
    }
    setBusy(false);
  }
  return [busy, add];
}

function PhotosStep({ draft, thumbs, product }) {
  const inputRef = useRef(null);
  const [busy, add] = useAdder();
  const [over, setOver] = useState(false);

  // Перетаскивание файлов в окно (на компьютере)
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setOver(true);
    };
    const leave = (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setOver(false);
    };
    const overFn = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      add(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const n = draft.photos.length;
  return (
    <div>
      <div className={"dropzone" + (over ? " over" : "")}>
        <IconUpload size={32} />
        <p style={{ margin: "8px 0" }}>Выберите фото с телефона или компьютера</p>
        <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Добавляем…" : "Выбрать фото"}
        </button>
        <p className="muted small" style={{ marginTop: 8 }}>
          JPEG или PNG. На компьютере можно просто перетащить файлы в окно.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png"
          multiple
          hidden
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {over && <div className="drop-overlay">Отпустите — добавим фото</div>}

      <div className="row between" style={{ margin: "16px 0 8px" }}>
        <b>Фото: {n}</b>
        {product.kind === "book" && <span className="muted small">{photoHint(draft.pages)}</span>}
      </div>
      {n === 0 ? (
        <p className="muted">Пока пусто. Добавьте фото — черновик сохранится сам, даже если закрыть страницу.</p>
      ) : (
        <div className="photo-grid">
          {draft.photos.map((p, i) => (
            <div key={p.id} className="photo-cell">
              {thumbs[p.id] ? <img src={thumbs[p.id]} alt={p.name} /> : <div className="bad">{p.supported ? "…" : "Формат не подходит"}</div>}
              <span className="num">{i + 1}</span>
              <div className="photo-tools">
                <button onClick={() => movePhoto(p.id, -1)} disabled={i === 0} aria-label="Раньше" title="Раньше">
                  <IconLeft size={18} />
                </button>
                <button onClick={() => removePhoto(p.id)} aria-label="Удалить" title="Удалить">
                  <IconTrash size={16} />
                </button>
                <button onClick={() => movePhoto(p.id, 1)} disabled={i === n - 1} aria-label="Позже" title="Позже">
                  <IconRight size={18} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="muted small" style={{ marginTop: 8 }}>
        Кнопки ‹ и › — раньше / позже в книге. Черновик сохраняется на этом устройстве автоматически.
      </p>
    </div>
  );
}

/* ---------- Шаг 2: автомакет ---------- */
function LayoutStep({ draft, thumbs, product }) {
  const { layout, issues } = useMemo(() => runChecks(draft, product), [draft, product]);
  const size = product.sizes.find((s) => s.id === draft.sizeId) || product.sizes[0];
  if (product.kind !== "book") return <PrintPreview draft={draft} thumbs={thumbs} size={size} issues={issues} />;
  return <BookPreview layout={layout} thumbs={thumbs} size={size} issues={issues} />;
}

function slotClass(issues, photoId) {
  const i = issues.find((x) => x.photoId === photoId && x.key.startsWith("dpi:"));
  return i ? (i.level === "err" ? " err" : " warn") : "";
}

function BookPreview({ layout, thumbs, size, issues }) {
  const spreads = [];
  for (let i = 0; i < layout.pages.length; i += 2) spreads.push([i, i + 1]);
  const [s, setS] = useState(0);
  const cur = Math.min(s, spreads.length - 1);
  const touch = useRef(null);
  const pw = Math.min(170, Math.floor((Math.min(typeof window !== "undefined" ? window.innerWidth : 375, 520) - 40) / 2));
  const ph = Math.round((pw * size.h) / size.w);

  const page = (idx) => {
    const pg = layout.pages[idx];
    if (!pg) return <div className="page blank" style={{ width: pw, height: ph }} />;
    if (!pg.slots.length)
      return (
        <div className="page empty" style={{ width: pw, height: ph }}>
          Пустая страница
        </div>
      );
    return (
      <div className="page" style={{ width: pw, height: ph }}>
        {pg.slots.map((sl) => (
          <div key={sl.photoId} className={"slot" + slotClass(issues, sl.photoId)} style={{ left: sl.x * 100 + "%", top: sl.y * 100 + "%", width: sl.w * 100 + "%", height: sl.h * 100 + "%" }}>
            {thumbs[sl.photoId] && <img src={thumbs[sl.photoId]} alt="" />}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div>
      <p className="muted">Автомакет разложил фото по страницам: 1–3 на страницу, вертикальные и горизонтальные — по своим местам. Листайте пальцем или кнопками.</p>
      <div
        onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touch.current == null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          if (dx < -40) setS(Math.min(spreads.length - 1, cur + 1));
          if (dx > 40) setS(Math.max(0, cur - 1));
          touch.current = null;
        }}
      >
        <div className="spread">
          {page(spreads[cur][0])}
          {page(spreads[cur][1])}
        </div>
        <div className="row between">
          <span className="page-num muted" style={{ width: pw }}>
            стр. {spreads[cur][0] + 1}
          </span>
          <span className="page-num muted" style={{ width: pw }}>
            {layout.pages[spreads[cur][1]] ? "стр. " + (spreads[cur][1] + 1) : ""}
          </span>
        </div>
      </div>
      <div className="row between" style={{ marginTop: 8 }}>
        <button className="btn btn-small" onClick={() => setS(Math.max(0, cur - 1))} disabled={cur === 0}>
          <IconLeft size={18} /> Назад
        </button>
        <span className="muted small">
          разворот {cur + 1} из {spreads.length}
        </span>
        <button className="btn btn-small" onClick={() => setS(Math.min(spreads.length - 1, cur + 1))} disabled={cur >= spreads.length - 1}>
          Вперёд <IconRight size={18} />
        </button>
      </div>
      {layout.overflow.length > 0 && <p className="err-text" style={{ marginTop: 12 }}>Не поместились фото: {layout.overflow.length}. Добавьте страницы — подробности в «Проверке».</p>}
      <p className="muted small" style={{ marginTop: 12 }}>
        Оранжевая рамка — фото может быть нечётким, красная — будет размыто.
      </p>
    </div>
  );
}

function PrintPreview({ draft, thumbs, size, issues }) {
  return (
    <div>
      <p className="muted">
        Так фото попадут в печать {size.id.replace("x", "×")} см. Края могут срезаться на несколько миллиметров; если пропорции снимка другие — лишнее обрежется, как на превью.
      </p>
      <div className="photo-grid">
        {draft.photos.filter((p) => p.supported).map((p) => {
          const land = p.w > p.h;
          const ratio = land ? `${Math.max(size.w, size.h)} / ${Math.min(size.w, size.h)}` : `${Math.min(size.w, size.h)} / ${Math.max(size.w, size.h)}`;
          return (
            <div key={p.id} style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div className={"page" + slotClass(issues, p.id)} style={{ aspectRatio: ratio, width: land ? "100%" : "70%", position: "relative" }}>
                <div className={"slot" + slotClass(issues, p.id)} style={{ inset: 0 }}>
                  {thumbs[p.id] && <img src={thumbs[p.id]} alt={p.name} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Шаг 3: проверка ---------- */
function CheckStep({ draft, thumbs, product, price, goPhotos }) {
  const router = useRouter();
  const { issues } = useMemo(() => runChecks(draft, product), [draft, product]);
  const replaceRef = useRef(null);
  const [replaceId, setReplaceId] = useState(null);
  const acks = draft.acks || {};
  const open = issues.filter((i) => !acks[i.key]);
  const blocking = issues.some((i) => i.blocking);

  const ack = (key) => updateDraft((d) => ({ ...d, acks: { ...(d.acks || {}), [key]: true } }));
  const fitPages = (n) => updateDraft((d) => ({ ...d, pages: n, acks: {} }));

  async function onReplace(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !replaceId) return;
    await replacePhoto(replaceId, f);
    notify("Фото заменено", "success");
    setReplaceId(null);
  }

  function addToCart() {
    const usable = draft.photos.filter((p) => p.supported);
    const firstThumb = usable[0] && thumbs[usable[0].id];
    const finish = (cover) => {
      const item = {
        id: "c" + Date.now(),
        productSlug: product.slug,
        name: (product.kind === "book" ? "Фотокнига " : "") + product.name,
        kind: product.kind,
        sizeId: draft.sizeId,
        optionId: draft.optionId,
        pages: product.kind === "book" ? draft.pages : null,
        photoCount: usable.length,
        price,
        printDays: product.printDays,
        cover,
      };
      // Черновик: в корзине одна позиция на черновик — повторное добавление заменяет её.
      const cart = readKey("cart", []).filter((c) => c.fromDraft !== draft.createdAt);
      writeKey("cart", [...cart, { ...item, fromDraft: draft.createdAt }]);
      notify("Добавлено в корзину", "success");
      router.push("/cart");
    };
    if (!firstThumb) return finish(null);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = 96;
      const s = Math.min(img.width, img.height);
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 96, 96);
      finish(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => finish(null);
    img.src = firstThumb;
  }

  return (
    <div>
      {issues.length === 0 ? (
        <div className="card issue ok">
          <div className="row">
            <IconCheck />
            <b>Всё хорошо — можно заказывать.</b>
          </div>
          <p className="muted small">Пустых страниц нет, формат и резкость в порядке.</p>
        </div>
      ) : (
        <p className="muted">
          Нашли моментов: {issues.length}. Исправьте или нажмите «Продолжить как есть» — решать вам.
        </p>
      )}
      {issues.map((i) => {
        const done = !!acks[i.key];
        return (
          <div key={i.key} className={"card issue " + (done ? "ok" : i.level)}>
            <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
              {i.photoId && (thumbs[i.photoId] ? <img className="issue-thumb" src={thumbs[i.photoId]} alt="" /> : <div className="issue-thumb" />)}
              <div style={{ flex: 1 }}>
                <b className={done ? "" : i.level === "err" ? "err-text" : "warn-text"}>
                  {!done && <IconAlert size={16} />} {i.title}
                  {done && " — оставили как есть"}
                </b>
                <p className="small" style={{ marginTop: 4 }}>{i.text}</p>
                {!done && (
                  <div className="row wrap" style={{ marginTop: 8 }}>
                    {i.actions.includes("replace") && (
                      <button
                        className="btn btn-small btn-primary"
                        onClick={() => {
                          setReplaceId(i.photoId);
                          replaceRef.current?.click();
                        }}
                      >
                        Заменить
                      </button>
                    )}
                    {i.actions.includes("add") && (
                      <button className="btn btn-small btn-primary" onClick={goPhotos}>
                        Добавить фото
                      </button>
                    )}
                    {i.actions.includes("fitPages") && (
                      <button className="btn btn-small" onClick={() => fitPages(i.fitPages)}>
                        Сделать {i.fitPages} стр.
                      </button>
                    )}
                    {!i.blocking && (
                      <button className="btn btn-small" onClick={() => ack(i.key)}>
                        Продолжить как есть
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <input ref={replaceRef} type="file" accept="image/jpeg,image/png" hidden onChange={onReplace} />

      <div className="card">
        <div className="row between">
          <span>Итого</span>
          <span className="price">{money(price)}</span>
        </div>
        <p className="muted small">
          Напечатаем за {product.printDays} дня — доставим ориентировочно {deliveryRange(product.printDays)}.
        </p>
        <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={blocking || open.length > 0} onClick={addToCart}>
          В корзину
        </button>
        {open.length > 0 && !blocking && <p className="muted small" style={{ marginTop: 6 }}>Осталось решить: {open.length}</p>}
      </div>
    </div>
  );
}
