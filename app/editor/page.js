"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DndContext, KeyboardSensor, MouseSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import {
  addFiles,
  addGalleryFiles,
  copyProject,
  dismissUpload,
  getDraftState,
  openProject,
  whenDraftReady,
  loadGallery,
  movePhoto,
  removePhoto,
  reorderPhoto,
  replacePhoto,
  retryUpload,
  setPhotoPlacement,
  updateDraft,
  useDraft,
} from "../../lib/draft";
import { useProduct } from "../../lib/useCatalog";
import { bookPrice, money, photoHint, printPrice } from "../../lib/price";
import { daysWord, etaFromDay, formatEtaRange, minskDate } from "../../lib/pricing";
import { runChecks } from "../../lib/checks";
import { notify } from "../../lib/store";
import { addToCart as putInCart } from "../../lib/cart";
import { callApi } from "../../lib/api";
import { useSyncState, whenInitialSync } from "../../lib/sync";
import { useOnline } from "../../components/Pwa";
import DraftError from "../../components/DraftError";
import { IconAlert, IconCheck, IconLeft, IconRight, IconTrash, IconUpload } from "../../components/icons";
import { photoBadges } from "../../lib/photo/badges";
import { ANALYSIS_VERSION, findDuplicates } from "../../lib/photo/analyze";
import { useStepTimer } from "@/lib/analytics";

// ИИ-редактор (шаг «Правки») — отдельный кусок кода, грузится только при открытии шага
const PhotoEditor = dynamic(() => import("../../components/editor/PhotoEditor"), {
  ssr: false,
  loading: () => <p className="muted">Открываем редактор…</p>,
});

// Фото с предупреждением о резкости в печати — как в «Проверке» (для значка «Мало точек для печати»)
function useLowDpi(draft, product) {
  return useMemo(() => {
    if (!draft || !product) return new Set();
    const { issues } = runChecks(draft, product);
    return new Set(issues.filter((i) => i.key.startsWith("dpi:")).map((i) => i.photoId));
  }, [draft, product]);
}

// Анализ новых фото в воркере (S03a): оценка качества и мягкое автоулучшение плохих
function useAnalysis(draft) {
  const need = !!draft && draft.status !== "ordered" && draft.photos.some((p) => p.supported && p.quality?.v !== ANALYSIS_VERSION);
  const id = draft?.id;
  useEffect(() => {
    if (!need || !id) return;
    import("../../lib/photo/analysis").then((m) => m.analyzeMissing(id)).catch(console.error);
  }, [need, id, draft?.photos.length]);
}

// Шаги как на слайде Фотопринт: Фото · Автомакет · Правки · Проверка · Заказ · Статус
const STEPS = [
  { id: "photos", label: "Фото" },
  { id: "layout", label: "Автомакет" },
  { id: "edits", label: "Правки" },
  { id: "check", label: "Проверка" },
  { id: "order", label: "Заказ" },
  { id: "status", label: "Статус" },
];

// Как фото ложится на своё место: заполнить (края обрежутся) или целиком; какая часть кадра важнее
function placeStyle(photo) {
  return { objectFit: photo?.fit === "contain" ? "contain" : "cover", objectPosition: photo?.focus || "50% 50%" };
}

// Прямая ссылка на проект (X-7): /editor?project=<id> — из пуша, закладки или установленного приложения.
// id — местный или из аккаунта (serverId). Проекты аккаунта появляются на устройстве после первой синхронизации.
const subscribeNone = () => () => {};
function useProjectLink() {
  const id = useSyncExternalStore(subscribeNone, () => new URLSearchParams(window.location.search).get("project") || "", () => "");
  const [done, setDone] = useState({ id: "", found: true });
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const find = () => Object.values(getDraftState().projects || {}).find((p) => p.id === id || p.serverId === id);
    (async () => {
      await whenDraftReady();
      let p = find();
      if (!p) {
        await whenInitialSync().catch(() => null);
        p = find();
      }
      if (p) await openProject(p.id);
      if (alive) setDone({ id, found: !!p });
    })();
    return () => {
      alive = false;
    };
  }, [id]);
  if (!id) return { state: "none", id };
  if (done.id !== id) return { state: "opening", id };
  return { state: done.found ? "open" : "missing", id };
}

export default function EditorPage() {
  const router = useRouter();
  const { ready, error, draft, thumbs, uploads } = useDraft();
  const { product, loading } = useProduct(draft?.productSlug);
  const [step, setStep] = useState("photos");
  useStepTimer(step);
  useAnalysis(draft);
  const lowDpi = useLowDpi(draft, product);
  const dups = useMemo(() => findDuplicates(draft?.photos || []), [draft?.photos]);
  const link = useProjectLink();

  if (error) return <DraftError />;
  if (link.state === "opening") return <p className="muted">Открываем проект…</p>;
  if (link.state === "missing")
    return (
      <div className="card stack">
        <h2>Проект не найден на этом устройстве</h2>
        <p className="muted">Если он сохранён в аккаунте — войдите, и он откроется. Черновики гостя хранятся только на том устройстве, где их создали.</p>
        <Link href={"/login?next=" + encodeURIComponent("/editor?project=" + link.id)} className="btn btn-primary btn-block">
          Войти
        </Link>
        <Link href="/books" className="btn btn-block">
          Мои книги
        </Link>
      </div>
    );

  if (!ready || (draft && loading)) return <p className="muted">Открываем черновик…</p>;
  if (!draft || !product)
    return (
      <div className="card">
        <h2>Черновика пока нет</h2>
        <p className="muted">Выберите фотокнигу или печать фото в каталоге — и начнём. Все проекты — в «Мои книги».</p>
        <div className="row wrap">
          <Link href="/" className="btn btn-primary">
            В каталог
          </Link>
          <Link href="/books" className="btn">
            Мои книги
          </Link>
        </div>
      </div>
    );

  const isBook = product.kind === "book";
  const ordered = draft.status === "ordered";
  const usable = draft.photos.filter((p) => p.supported).length;
  const qty = draft.quantity || 1;
  const price = (isBook ? bookPrice(product, draft.pages, draft.sizeId) : printPrice(product, draft.sizeId, usable)) * qty;

  function go(id) {
    if (id === "order") {
      if (draft.status === "in_cart") return router.push("/cart");
      if (ordered) return draft.orderId ? router.push("/orders/" + draft.orderId) : router.push("/orders");
      notify("Сначала «Проверка» — оттуда проект попадёт в корзину и к оформлению.", "info");
      return setStep("check");
    }
    if (id === "status") return router.push(draft.orderId ? "/orders/" + draft.orderId : "/orders");
    setStep(id);
  }

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
              {qty > 1 ? ` · ${qty} экз.` : ""}
            </div>
          </div>
          {!ordered && (
            <Link href={"/product/" + product.slug} className="btn btn-small">
              Изменить
            </Link>
          )}
        </div>
      </div>
      {ordered && <OrderedNotice draft={draft} />}
      <nav className="steps" aria-label="Шаги редактора">
        {STEPS.map((s) => (
          <button
            key={s.id}
            aria-current={step === s.id ? "step" : undefined}
            className={step === s.id ? "active" : ""}
            onClick={() => go(s.id)}
            disabled={s.id === "status" && !ordered}
            title={s.id === "status" && !ordered ? "Статус появится после заказа" : undefined}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {step === "photos" && <PhotosStep draft={draft} thumbs={thumbs} product={product} uploads={uploads} readOnly={ordered} lowDpi={lowDpi} dups={dups} />}
      {step === "layout" && <LayoutStep draft={draft} thumbs={thumbs} product={product} />}
      {step === "edits" && (
        <PhotoEditor draft={draft} thumbs={thumbs} readOnly={ordered} lowDpiIds={lowDpi} dupIds={dups} extra={(photo) => <PlacementCard photo={photo} thumb={thumbs[photo.id]} readOnly={ordered} />} />
      )}
      {step === "check" && <CheckStep draft={draft} thumbs={thumbs} product={product} price={price} goPhotos={() => setStep("photos")} readOnly={ordered} />}

      <div className="sticky-bar">
        <div>
          <div className="muted small">{isBook ? (qty > 1 ? `${qty} книги` : "Цена книги") : `${usable} × ${money(product.sizes.find((s) => s.id === draft.sizeId).unitPrice)}${qty > 1 ? ` × ${qty}` : ""}`}</div>
          <b style={{ fontSize: 20, color: "var(--ds-color-text-strong)" }}>{money(price)}</b>
        </div>
        {step !== "check" ? (
          <button className="btn btn-primary" onClick={() => setStep(step === "photos" ? "layout" : step === "layout" ? "edits" : "check")} disabled={!draft.photos.length}>
            Дальше
          </button>
        ) : null}
      </div>
    </div>
  );
}

function OrderedNotice({ draft }) {
  const router = useRouter();
  async function again() {
    await copyProject(draft.id);
    notify("Копия проекта готова — можно менять и заказывать", "success");
    router.refresh();
  }
  return (
    <div className="card issue ok">
      <b>Этот проект уже заказан{draft.orderNumber ? ` (заказ ${draft.orderNumber})` : ""} и не меняется.</b>
      <p className="small muted">Чтобы напечатать такой же или поправить — сделайте копию.</p>
      <div className="row wrap">
        {draft.orderId && (
          <Link href={"/orders/" + draft.orderId} className="btn btn-small btn-primary">
            Открыть заказ
          </Link>
        )}
        <button className="btn btn-small" onClick={again}>
          Заказать ещё раз
        </button>
      </div>
    </div>
  );
}

/* ---------- Шаг 1: фото ---------- */
function useAdder() {
  const [busy, setBusy] = useState(false);
  async function add(files, fromGallery) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const { added, rejected, failed } = fromGallery ? await addGalleryFiles(files) : await addFiles(files);
      if (added) notify(`Добавлено фото: ${added}`, "success");
      if (rejected.length) notify(`Это не фото, пропустили: ${rejected.join(", ")}`, "error");
      if (failed) notify(`Не получилось добавить фото: ${failed}. Нажмите «Повторить» в списке.`, "error");
    } catch (e) {
      console.error(e);
      notify("Не удалось добавить фото. Проверьте интернет и попробуйте ещё раз.", "error");
    } finally {
      setBusy(false);
    }
  }
  return [busy, add];
}

const UPLOAD_TEXT = { wait: "ждёт очереди", work: "готовим…", error: "не получилось" };

function PhotosStep({ draft, thumbs, product, uploads, readOnly, lowDpi, dups }) {
  const inputRef = useRef(null);
  const [busy, add] = useAdder();
  const [over, setOver] = useState(false);
  const [gallery, setGallery] = useState(false);

  // Перетаскивание файлов в окно (на компьютере)
  useEffect(() => {
    if (readOnly) return;
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
  }, [readOnly]);

  const n = draft.photos.length;
  return (
    <div>
      {!readOnly && (
        <div className={"dropzone" + (over ? " over" : "")}>
          <IconUpload size={32} />
          <p style={{ margin: "8px 0" }}>Выберите фото с телефона или компьютера</p>
          <div className="row wrap" style={{ justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? "Добавляем…" : "Выбрать фото"}
            </button>
            <button className="btn" onClick={() => setGallery((g) => !g)} aria-expanded={gallery} disabled={busy}>
              Тестовая галерея
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            JPEG или PNG до 25 МБ, можно сразу несколько. На компьютере можно просто перетащить файлы в окно.
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
      )}
      {gallery && !readOnly && (
        <GalleryPanel
          busy={busy}
          onAdd={async (items) => {
            await add(items, true);
            setGallery(false);
          }}
        />
      )}
      {over && <div className="drop-overlay">Отпустите — добавим фото</div>}

      {uploads.length > 0 && (
        <ul className="uploads card" aria-live="polite" aria-label="Добавление фото">
          {uploads.map((u) => (
            <li key={u.id}>
              <span className="name">{u.name}</span>
              {u.status === "error" ? (
                <span className="row" style={{ gap: 6 }}>
                  <span className="err-text small">{UPLOAD_TEXT.error}</span>
                  <button className="btn btn-small" onClick={() => retryUpload(u.id)}>
                    Повторить
                  </button>
                  <button className="btn btn-small" onClick={() => dismissUpload(u.id)}>
                    Убрать
                  </button>
                </span>
              ) : (
                <span className="muted small">{UPLOAD_TEXT[u.status]}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="row between" style={{ margin: "16px 0 8px" }}>
        <b>Фото: {n}</b>
        {product.kind === "book" && <span className="muted small">{photoHint(draft.pages)}</span>}
      </div>
      {n === 0 ? (
        <p className="muted">Пока пусто. Добавьте фото — черновик сохранится сам, даже если закрыть страницу.</p>
      ) : (
        <SortablePhotos draft={draft} thumbs={thumbs} readOnly={readOnly} lowDpi={lowDpi} dups={dups} />
      )}
      {!readOnly && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Кнопки ‹ и › — раньше / позже в книге. На компьютере фото можно перетащить за значок ⠿ мышью или клавиатурой (Tab, пробел, стрелки). Черновик сохраняется на этом устройстве автоматически.
        </p>
      )}
    </div>
  );
}

// Подписи «проблем» тестовых фото (manifest.json)
const PROBLEM = {
  beach: "пляж", sun: "солнце в кадре", backlight: "контровой свет", dark: "тёмное", stranger: "посторонний",
  overexposed: "пересвет", "color-cast": "оттенок", blurry: "размыто", "low-resolution": "маленькое", tilted: "завален горизонт", duplicate: "дубль",
};

function GalleryPanel({ busy, onAdd }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState({});
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    loadGallery()
      .then((list) => {
        if (!alive) return;
        setItems(list);
        setFailed(false);
        setPicked(Object.fromEntries(list.slice(0, 12).map((x) => [x.file, true])));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);
  const chosen = (items || []).filter((x) => picked[x.file]);
  return (
    <section className="card" aria-label="Тестовая галерея">
      <h3>Тестовая галерея</h3>
      <p className="muted small">
        Фото со свободной лицензией (Wikimedia Commons). Среди них есть «плохие» — маленькое, размытое, тёмное — чтобы увидеть, как работает проверка.
      </p>
      {failed && (
        <p className="err-text small">
          Галерея не загрузилась. Проверьте интернет.{" "}
          <button className="btn btn-small" onClick={() => setAttempt((a) => a + 1)}>
            Повторить
          </button>
        </p>
      )}
      {!items && !failed && <p className="muted small">Загружаем галерею…</p>}
      {items && (
        <>
          <div className="gallery-grid">
            {items.map((it) => (
              <label key={it.file} title={it.title}>
                <img src={"/demo-gallery/" + it.file} alt={it.title} loading="lazy" />
                <input type="checkbox" checked={!!picked[it.file]} onChange={(e) => setPicked((p) => ({ ...p, [it.file]: e.target.checked }))} aria-label={it.title} />
                {it.problem && <span className="tag">{PROBLEM[it.problem] || it.problem}</span>}
              </label>
            ))}
          </div>
          <div className="row wrap">
            <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={() => onAdd(chosen)}>
              {busy ? "Добавляем…" : `Добавить ${chosen.length} фото`}
            </button>
            <button className="btn btn-small" onClick={() => setPicked(Object.fromEntries(items.map((x) => [x.file, true])))}>
              Выбрать все
            </button>
            <button className="btn btn-small" onClick={() => setPicked({})}>
              Снять выбор
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// Сетка фото: на компьютере — перетаскивание (мышь и клавиатура), на телефоне — кнопки «раньше / позже»
function SortablePhotos({ draft, thumbs, readOnly, lowDpi, dups }) {
  const sync = useSyncState();
  const online = useOnline();
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const ids = draft.photos.map((p) => p.id);
  const pos = (id) => ids.indexOf(id) + 1;
  const accessibility = {
    screenReaderInstructions: { draggable: "Чтобы переставить фото, нажмите пробел, двигайте стрелками и нажмите пробел ещё раз. Escape — отмена." },
    announcements: {
      onDragStart: ({ active }) => `Взяли фото ${pos(active.id)}.`,
      onDragOver: ({ active, over }) => (over ? `Фото ${pos(active.id)} над местом ${pos(over.id)}.` : `Фото ${pos(active.id)} вне сетки.`),
      onDragEnd: ({ active, over }) => (over ? `Фото поставлено на место ${pos(over.id)}.` : `Фото ${pos(active.id)} осталось на месте.`),
      onDragCancel: ({ active }) => `Отмена. Фото ${pos(active.id)} осталось на месте.`,
    },
  };
  function onDragEnd({ active, over }) {
    if (!over || active.id === over.id) return;
    reorderPhoto(ids.indexOf(active.id), ids.indexOf(over.id));
  }
  return (
    <DndContext id="photos-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd} accessibility={accessibility}>
      <SortableContext items={ids} strategy={rectSortingStrategy} disabled={readOnly}>
        <div className="photo-grid">
          {draft.photos.map((p, i) => (
            <SortablePhoto
              key={p.id}
              p={p}
              i={i}
              n={draft.photos.length}
              thumb={thumbs[p.id]}
              readOnly={readOnly}
              badges={photoBadges(p, { lowDpi: lowDpi?.has(p.id), duplicate: dups?.has(p.id) })}
              upload={sync.enabled && p.supported && draft.status !== "ordered" ? (p.serverId ? "done" : online ? "sending" : "waiting") : null}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

// Загрузка фото в аккаунт (X-5, только у вошедшего клиента): «Загружено», «Загружается», «Ждёт сети»
const UPLOAD_LABELS = { done: "Загружено", sending: "Загружается", waiting: "Ждёт сети" };

function SortablePhoto({ p, i, n, thumb, readOnly, badges, upload }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: readOnly });
  const style = { transform: transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined, transition };
  return (
    <div ref={setNodeRef} style={style} className={"photo-cell" + (isDragging ? " dragging" : "")} data-photo={p.name}>
      {thumb ? <img src={thumb} alt={p.name} /> : <div className="bad">{p.supported ? "…" : p.tooBig ? "Больше 25 МБ" : "Формат не подходит"}</div>}
      <span className="num">{i + 1}</span>
      {upload && (
        <span className={"photo-upload photo-upload-" + upload} data-upload={upload}>
          {UPLOAD_LABELS[upload]}
        </span>
      )}
      {badges?.length > 0 && (
        <span className="pe-badges compact" aria-label={"Фото " + (i + 1) + ": " + badges.map((b) => b.label).join(", ")}>
          {badges.map((b) => (
            <span key={b.id} className={"pe-badge " + b.tone} data-badge={b.id} title={b.label}>
              {b.short || b.label}
            </span>
          ))}
        </span>
      )}
      {!readOnly && (
        <>
          <button ref={setActivatorNodeRef} className="drag-handle" {...attributes} {...listeners} aria-label={`Переставить фото ${i + 1}`} title="Перетащите, чтобы переставить">
            ⠿
          </button>
          <div className="photo-tools">
            <button onClick={() => movePhoto(p.id, -1)} disabled={i === 0} aria-label={`Раньше: фото ${i + 1}`} title="Раньше">
              <IconLeft size={18} />
            </button>
            <button onClick={() => removePhoto(p.id)} aria-label={`Удалить фото ${i + 1}`} title="Удалить">
              <IconTrash size={16} />
            </button>
            <button onClick={() => movePhoto(p.id, 1)} disabled={i === n - 1} aria-label={`Позже: фото ${i + 1}`} title="Позже">
              <IconRight size={18} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Шаг 2: автомакет ---------- */
function LayoutStep({ draft, thumbs, product }) {
  const { layout, issues } = useMemo(() => runChecks(draft, product), [draft, product]);
  const size = product.sizes.find((s) => s.id === draft.sizeId) || product.sizes[0];
  if (product.kind !== "book") return <PrintPreview draft={draft} thumbs={thumbs} size={size} issues={issues} />;
  const byId = Object.fromEntries(draft.photos.map((p) => [p.id, p]));
  return <BookPreview layout={layout} thumbs={thumbs} size={size} issues={issues} byId={byId} />;
}

function slotClass(issues, photoId) {
  const i = issues.find((x) => x.photoId === photoId && x.key.startsWith("dpi:"));
  return i ? (i.level === "err" ? " err" : " warn") : "";
}

function BookPreview({ layout, thumbs, size, issues, byId }) {
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
            {thumbs[sl.photoId] && <img src={thumbs[sl.photoId]} alt="" style={placeStyle(byId[sl.photoId])} />}
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
                  {thumbs[p.id] && <img src={thumbs[p.id]} alt={p.name} style={placeStyle(p)} />}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Шаг «Правки»: кадрирование и размещение ---------- */
const FOCUS = [
  ["0% 0%", "↖", "верх слева"], ["50% 0%", "↑", "верх"], ["100% 0%", "↗", "верх справа"],
  ["0% 50%", "←", "слева"], ["50% 50%", "•", "центр"], ["100% 50%", "→", "справа"],
  ["0% 100%", "↙", "низ слева"], ["50% 100%", "↓", "низ"], ["100% 100%", "↘", "низ справа"],
];

// Кадрирование выбранного в редакторе фото: заполнить место или целиком, что важнее оставить в кадре
function PlacementCard({ photo, thumb, readOnly }) {
  const fit = photo.fit === "contain" ? "contain" : "cover";
  const focus = photo.focus || "50% 50%";
  return (
    <div className="card">
      <h3>Кадрирование</h3>
      <p className="muted small">Как фото ляжет на своё место — заполнит его целиком (края обрежутся) или войдёт полностью, с белыми полями.</p>
      <div className="row wrap" style={{ alignItems: "flex-start", gap: 16 }}>
        <div className="place-preview" aria-hidden="true">{thumb && <img src={thumb} alt="" style={placeStyle(photo)} />}</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div className="options">
            <button className={"option" + (fit === "cover" ? " selected" : "")} aria-pressed={fit === "cover"} disabled={readOnly} onClick={() => setPhotoPlacement(photo.id, { fit: "cover" })}>
              <b>Заполнить место</b>
              <span>края обрежутся</span>
            </button>
            <button className={"option" + (fit === "contain" ? " selected" : "")} aria-pressed={fit === "contain"} disabled={readOnly} onClick={() => setPhotoPlacement(photo.id, { fit: "contain" })}>
              <b>Целиком</b>
              <span>с белыми полями</span>
            </button>
          </div>
          {fit === "cover" && (
            <>
              <p className="small" style={{ margin: "8px 0 4px" }}>Что важнее оставить в кадре:</p>
              <div className="focus-grid" role="group" aria-label="Что важнее оставить в кадре">
                {FOCUS.map(([v, icon, label]) => (
                  <button key={v} aria-pressed={focus === v} aria-label={label} title={label} disabled={readOnly} onClick={() => setPhotoPlacement(photo.id, { focus: v })}>
                    {icon}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <p className="muted small" style={{ marginTop: 8 }}>Изменения видны в «Автомакете» и сохраняются в черновике.</p>
    </div>
  );
}

/* ---------- Шаг 3: проверка ---------- */
function CheckStep({ draft, thumbs, product, price, goPhotos, readOnly }) {
  const router = useRouter();
  const { issues } = useMemo(() => runChecks(draft, product), [draft, product]);
  const replaceRef = useRef(null);
  const [replaceId, setReplaceId] = useState(null);
  const acks = draft.acks || {};
  const open = issues.filter((i) => !acks[i.key]);
  const blocking = issues.some((i) => i.blocking);

  // «Продолжить всё равно» — осознанное решение: отметка в проекте и запись в журнал (для вошедших)
  const ack = (issue) => {
    updateDraft((d) => ({ ...d, acks: { ...(d.acks || {}), [issue.key]: { at: Date.now(), title: issue.title } } }));
    // Гостю журнал на сервере не пишем (нет аккаунта) — отметка остаётся в проекте на устройстве
    callApi("/api/v1/me", { method: "GET" }).then((me) => {
      if (me.authenticated && me.activeRole === "client") callApi("/api/v1/checks/ack", { body: { issue: issue.key.split(":")[0], title: issue.title, productSlug: product.slug, projectId: draft.id } });
    });
  };
  // «Продолжить всё равно для всех» — одно решение по всем открытым предупреждениям, одна запись в журнал
  const openAckable = open.filter((i) => !i.blocking);
  const ackAll = () => {
    if (!openAckable.length) return;
    const at = Date.now();
    updateDraft((d) => ({ ...d, acks: { ...(d.acks || {}), ...Object.fromEntries(openAckable.map((i) => [i.key, { at, title: i.title }])) } }));
    const titles = [...new Set(openAckable.map((i) => i.title))].join(", ");
    callApi("/api/v1/me", { method: "GET" }).then((me) => {
      if (me.authenticated && me.activeRole === "client")
        callApi("/api/v1/checks/ack", { body: { issue: "all", title: `Для всех (${openAckable.length}): ${titles}`.slice(0, 120), productSlug: product.slug, projectId: draft.id } });
    });
  };
  const fitPages = (n) => updateDraft((d) => ({ ...d, pages: n, acks: {} }));

  async function onReplace(e) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !replaceId) return;
    try {
      await replacePhoto(replaceId, f);
      notify("Фото заменено", "success");
    } catch (err) {
      console.error(err);
      notify("Не удалось заменить фото. Попробуйте ещё раз.", "error");
    } finally {
      setReplaceId(null);
    }
  }

  function addToCart() {
    if (readOnly) return;
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
        quantity: draft.quantity || 1,
        options: draft.options || {},
        projectId: draft.id,
        price,
        printDays: product.printDays,
        cover,
      };
      // Черновик: в корзине одна позиция на проект — повторное добавление заменяет её.
      // Вошедшему клиенту позиция уходит в корзину на сервере (lib/cart.js), гостю — остаётся на устройстве.
      putInCart({ ...item, fromDraft: draft.createdAt })
        .then(() => {
          notify("Добавлено в корзину", "success");
          router.push("/cart");
        })
        .catch((e) => {
          console.error(e);
          notify("Не получилось добавить в корзину. Попробуйте ещё раз.", "error");
        });
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
          Нашли моментов: {issues.length}. Исправьте или нажмите «Продолжить всё равно» — решать вам.
        </p>
      )}
      {openAckable.length > 1 && !readOnly && (
        <button className="btn btn-block" style={{ marginBottom: 12 }} onClick={ackAll}>
          Продолжить всё равно для всех ({openAckable.length})
        </button>
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
                        Заменить фото
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
                      <button className="btn btn-small" onClick={() => ack(i)}>
                        Продолжить всё равно
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
        <EtaLine product={product} />
        <button className="btn btn-primary btn-block" style={{ marginTop: 8 }} disabled={readOnly || blocking || open.length > 0} onClick={addToCart}>
          {draft.status === "in_cart" ? "Обновить в корзине" : "В корзину"}
        </button>
        {open.length > 0 && !blocking && <p className="muted small" style={{ marginTop: 6 }}>Осталось решить: {open.length}</p>}
      </div>
    </div>
  );
}

// Срок по Минску: печать + самый первый способ доставки из каталога
function EtaLine({ product }) {
  const { catalog } = useProduct(product.slug);
  const d = catalog?.delivery?.[0];
  if (!d) return null;
  const eta = etaFromDay(minskDate(), product.printDays, d.minDays, d.maxDays);
  return (
    <p className="muted small">
      Напечатаем за {daysWord(product.printDays)} — доставим ориентировочно {formatEtaRange(eta.from, eta.to)} ({d.name}). Сроки по Минску.
    </p>
  );
}
