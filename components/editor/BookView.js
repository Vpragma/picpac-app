"use client";
// Превью фотокниги «как настоящая» (N11): обложка, развороты, задняя обложка; перелистывание с 3D-эффектом
// (только transform и opacity, при prefers-reduced-motion — без анимации), свайп на телефоне, стрелки клавиатуры
// и кнопки на компьютере, «Разворот N из M» для экранного диктора. Кнопка с иконкой «180°» — книга на весь экран
// (<dialog>: фокус внутри, Esc закрывает, фокус возвращается на кнопку).
// Шаблоны оформления и обложка — lib/book.js; выбор — BookDesign (шаг «Автомакет»). Стили — app/editor/book.css.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconLeft, IconRight } from "../icons";
import { ART_SVG, Leaf, Maple, Oak } from "../season/SeasonArt";
import { COVER_LAYOUTS, TITLE_MAX, bookTemplate, normBook, templatesInOrder, textLength } from "../../lib/book";
import { getLocalPhotoBlob, setBook } from "../../lib/draft";
import { useSeason } from "../../lib/season";

const FLIP_MS = 650;

const reduceQuery = "(prefers-reduced-motion: reduce)";
function subscribeReduce(cb) {
  const m = window.matchMedia(reduceQuery);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}
function useReducedMotion() {
  return useSyncExternalStore(subscribeReduce, () => window.matchMedia(reduceQuery).matches, () => false);
}

// Размер окна и тип указателя — для подсказки «Поверните телефон» (N7 D2)
function subscribeResize(cb) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
function useViewport() {
  const snap = useSyncExternalStore(
    subscribeResize,
    () => `${window.innerWidth}x${window.innerHeight}x${window.matchMedia("(pointer: coarse)").matches ? 1 : 0}`,
    () => "0x0x0",
  );
  const [w, h, coarse] = snap.split("x").map(Number);
  return { w, h, coarse: coarse === 1 };
}

// Высота книги «на весь экран» на экране w×h — та же раскладка, что в book.css (раздел 6). Нужна, чтобы подсказка
// «Поверните телефон» появлялась, только если в другой ориентации книга правда станет крупнее.
function bigBookHeight(w, h, ar) {
  if (w > h && h <= 560) return Math.min((w - 120) / ar, h - 38); // телефон лёжа: кнопки по бокам, подписи — одна строка
  const pad = w <= 600 ? 8 : 16;
  return Math.min((Math.min(w, 1200) - 2 * pad) / ar, h - 2 * pad - 184);
}

// N7 D4: в превью — миниатюра 480 px. Если место на экране крупнее (с учётом плотности экрана, не больше ×2), подменяем её
// уменьшенной копией оригинала с устройства нужного размера. Лениво: только для показанных страниц, по одному фото за раз;
// в памяти — не больше SHARP_MAX копий (старые освобождаются).
const SHARP_MAX = 24;
const sharpCache = new Map(); // «id@px» → адрес копии
const sharpWait = new Map();
let sharpChain = Promise.resolve();

function sharpCopy(id, w, h, px) {
  const key = id + "@" + px;
  if (sharpCache.has(key)) {
    const url = sharpCache.get(key);
    sharpCache.delete(key);
    sharpCache.set(key, url); // свежая — в конец очереди на освобождение
    return Promise.resolve(url);
  }
  if (sharpWait.has(key)) return sharpWait.get(key);
  const k = px / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * k));
  const th = Math.max(1, Math.round(h * k));
  const job = sharpChain
    .then(async () => {
      const blob = await getLocalPhotoBlob(id);
      if (!blob) return null;
      let bmp;
      try {
        bmp = await createImageBitmap(blob, { resizeWidth: tw, resizeHeight: th, resizeQuality: "high" });
      } catch {
        bmp = await createImageBitmap(blob);
      }
      const c = document.createElement("canvas");
      c.width = tw;
      c.height = th;
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(bmp, 0, 0, tw, th);
      bmp.close?.();
      const out = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
      c.width = c.height = 0;
      if (!out) return null;
      const url = URL.createObjectURL(out);
      sharpCache.set(key, url);
      while (sharpCache.size > SHARP_MAX) {
        const [oldKey, oldUrl] = sharpCache.entries().next().value;
        sharpCache.delete(oldKey);
        URL.revokeObjectURL(oldUrl);
      }
      return url;
    })
    .catch(() => null);
  sharpChain = job;
  sharpWait.set(key, job);
  job.finally(() => sharpWait.delete(key));
  return job;
}

// Фото на странице: миниатюра, а если места на экране больше — чёткая копия (см. sharpCopy)
function PhotoImg({ id, ctx }) {
  const photo = ctx.byId[id];
  const thumb = ctx.thumbs[id];
  const w = photo?.w || 0;
  const h = photo?.h || 0;
  const contain = photo?.fit === "contain";
  const ref = useRef(null);
  const asked = useRef(0);
  const [hi, setHi] = useState(null);
  const check = useCallback(() => {
    const img = ref.current;
    if (!img || !img.complete || !img.naturalWidth || !w || !h) return;
    const bw = img.clientWidth;
    const bh = img.clientHeight;
    if (!bw || !bh) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const long = Math.max(w, h);
    const k = Math.min(1, (contain ? Math.min(bw / w, bh / h) : Math.max(bw / w, bh / h)) * dpr);
    const need = long * k;
    const have = Math.max(img.naturalWidth, img.naturalHeight);
    if (need <= have * 1.25) return; // миниатюры хватает
    const px = Math.min(long, Math.ceil(need / 256) * 256);
    if (px <= have || asked.current >= px) return;
    asked.current = px;
    sharpCopy(id, w, h, px).then((url) => url && setHi({ id, url }));
  }, [id, w, h, contain]);
  const src = hi && hi.id === id ? hi.url : thumb;
  useEffect(() => {
    const img = ref.current;
    if (!img || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => check());
    ro.observe(img);
    return () => ro.disconnect();
  }, [check, src]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element -- фото клиента с устройства (blob:/data:): next/image их не оптимизирует
  return <img ref={ref} src={src} alt="" draggable={false} style={ctx.placeStyle(photo)} onLoad={check} />;
}

// N7 D1: название и дата на обложке помещаются целиком: шрифт уменьшается под длину и место (перенос по словам).
// Размеры шрифта — доли ширины страницы (cqw) × --bk-fit, поэтому на телефоне и на компьютере перенос одинаковый.
// Слово длиннее строки даже при самом мелком шрифте — последний вариант: перенос посреди слова (класс bk-fit-break).
const FIT_MIN = 0.15;
function fitCoverText(box) {
  const inner = box?.firstElementChild;
  if (!inner || !box.isConnected) return;
  const cs = getComputedStyle(box);
  const room = () => box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const fits = () => {
    if (inner.offsetHeight > room() + 0.5) return false;
    for (const el of inner.children) if (el.scrollWidth > el.clientWidth + 0.5) return false;
    return true;
  };
  const set = (k) => box.style.setProperty("--bk-fit", String(k));
  box.classList.remove("bk-fit-break");
  set(1);
  if (fits()) return;
  let lo = FIT_MIN;
  let hi = 1;
  for (let i = 0; i < 10; i++) {
    const mid = (lo + hi) / 2;
    set(mid);
    if (fits()) lo = mid;
    else hi = mid;
  }
  set(lo);
  if (!fits()) box.classList.add("bk-fit-break");
}

function useCoverFit(ref, deps) {
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    fitCoverText(box);
    let alive = true;
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fitCoverText(box)) : null;
    ro?.observe(box.parentElement);
    document.fonts?.ready.then(() => alive && fitCoverText(box));
    return () => {
      alive = false;
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт при смене текста и варианта обложки
  }, deps);
}

// Иконка «180°» из брендбука (раскрытие книги): книга раскрыта в линию, над ней дуга. Нарисована нами, линейная.
export function Icon180({ size = 24 }) {
  return (
    <svg width={(size * 4) / 3} height={size} viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M2.5 20.5 C7 19 11.5 19 16 20.5 C20.5 19 25 19 29.5 20.5" />
      <path d="M16 17.5 V22" />
      <path d="M5 15.5 C5.5 9 10 5.5 16 5.5 C22 5.5 26.5 9 27 15.5" />
      <path d="M24.4 13.4 L27 15.8 L29.2 13" />
      <path d="M7.6 13.4 L5 15.8 L2.8 13" />
      <text x="16" y="14.2" fontSize="6.4" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="inherit" fontWeight="500">
        180°
      </text>
    </svg>
  );
}

// Украшения шаблона: линейная графика в полях страницы, под фото (не закрывает снимки)
function Decor({ tpl, where = "page" }) {
  const box = { "aria-hidden": true, focusable: "false", ...ART_SVG };
  if (tpl === "autumn")
    return (
      <>
        <svg className="bk-decor bk-tl season-art" viewBox="0 0 100 100" {...box}>
          <Maple x={42} y={42} s={0.62} r={-28} />
        </svg>
        <svg className="bk-decor bk-br season-art" viewBox="0 0 100 100" {...box}>
          <Leaf x={64} y={60} s={1.25} r={24} />
          {where !== "page" && <Oak x={34} y={70} s={0.42} r={-36} />}
        </svg>
      </>
    );
  if (tpl === "wedding")
    return (
      <svg className="bk-decor bk-bc tone-1" viewBox="0 0 100 30" {...box} strokeWidth={1.4}>
        <circle cx="45" cy="16" r="8" />
        <circle cx="55" cy="16" r="8" />
        <path d="M30 16 C24 12 18 12 12 15 M30 16 C24 19 18 19 12 16 M70 16 C76 12 82 12 88 15 M70 16 C76 19 82 19 88 16" />
      </svg>
    );
  if (tpl === "baby")
    return (
      <>
        <svg className="bk-decor bk-tr tone-2" viewBox="0 0 100 100" {...box} strokeWidth={1.6}>
          <path d="M30 62 C22 62 18 55 22 49 C24 41 34 38 40 43 C44 33 60 32 64 43 C72 41 80 47 77 56 C76 60 72 62 68 62 Z" />
          <path d="M78 22 L80 28 L86 30 L80 32 L78 38 L76 32 L70 30 L76 28 Z" />
        </svg>
        <svg className="bk-decor bk-bl tone-2" viewBox="0 0 100 100" {...box} strokeWidth={1.6}>
          <path d="M24 60 L26 66 L32 68 L26 70 L24 76 L22 70 L16 68 L22 66 Z" />
          <circle cx="44" cy="80" r="3" />
        </svg>
      </>
    );
  if (tpl === "travel")
    return (
      <>
        <svg className="bk-decor bk-bc bk-route tone-3" viewBox="0 0 100 30" {...box} strokeWidth={1.4}>
          <path d="M4 22 C20 8 34 26 50 16 C62 9 72 10 82 14" strokeDasharray="3 3" />
        </svg>
        <svg className="bk-decor bk-tr tone-1" viewBox="0 0 100 100" {...box} strokeWidth={1.6}>
          <path d="M58 30 L86 18 L74 46 L68 36 Z M68 36 L86 18" />
          <circle cx="40" cy="40" r="10" />
          <path d="M40 22 V26 M40 54 V58 M22 40 H26 M54 40 H58" />
        </svg>
      </>
    );
  return null;
}

function pageClass(tpl) {
  return "bk-page tpl-" + tpl + (tpl === "autumn" ? " season-palette-autumn" : "");
}

// Одна сторона листа: обложка, страница с фото, пустая, задняя обложка
function Face({ spec, ctx, side }) {
  if (!spec || spec.kind === "none") return null;
  const tpl = ctx.book.template;
  const cls = pageClass(tpl) + " side-" + side;
  if (spec.kind === "cover") return <Cover ctx={ctx} cls={cls} />;
  if (spec.kind === "back")
    return (
      <div className={cls + " bk-back-cover"}>
        <Decor tpl={tpl} where="cover" />
      </div>
    );
  const pg = ctx.layout.pages[spec.idx];
  if (!pg)
    return (
      <div className={cls}>
        <Decor tpl={tpl} />
      </div>
    );
  if (!pg.slots.length)
    return (
      <div className={cls + " bk-empty"}>
        <Decor tpl={tpl} />
        <span>Пустая страница</span>
      </div>
    );
  return (
    <div className={cls}>
      <Decor tpl={tpl} />
      {pg.slots.map((sl) => (
        <div key={sl.photoId} className={"bk-slot" + ctx.slotClass(sl.photoId)} style={{ left: sl.x * 100 + "%", top: sl.y * 100 + "%", width: sl.w * 100 + "%", height: sl.h * 100 + "%" }}>
          <PhotoImg id={sl.photoId} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

function Cover({ ctx, cls }) {
  const { title, date, layout } = ctx.book.cover;
  const id = ctx.coverPhotoId;
  const box = useRef(null);
  useCoverFit(box, [title, date, layout, ctx.book.template]);
  return (
    <div className={cls + " bk-cover cover-" + layout} data-cover-layout={layout}>
      <Decor tpl={ctx.book.template} where="cover" />
      {layout !== "title" && <div className="bk-cover-photo">{id && <PhotoImg id={id} ctx={ctx} />}</div>}
      {(title || date) && (
        <div className="bk-cover-text" ref={box}>
          <div className="bk-cover-fit">
            {layout === "title" && <span className="bk-cover-rule" aria-hidden="true" />}
            {title && <b className="bk-cover-title">{title}</b>}
            {date && <span className="bk-cover-date">{date}</span>}
            {layout === "title" && <span className="bk-cover-rule" aria-hidden="true" />}
          </div>
        </div>
      )}
    </div>
  );
}

// Обложка → развороты → задняя обложка. Сторона: { kind: cover | page | back | none, idx }
export function bookViews(pageCount) {
  const spreads = Math.max(1, Math.ceil(pageCount / 2));
  const views = [{ left: { kind: "none" }, right: { kind: "cover" }, label: "Обложка", shift: -25 }];
  for (let k = 0; k < spreads; k++)
    views.push({ left: { kind: "page", idx: 2 * k }, right: { kind: "page", idx: 2 * k + 1 }, label: `Разворот ${k + 1} из ${spreads}`, pages: [2 * k + 1, 2 * k + 2] });
  views.push({ left: { kind: "back" }, right: { kind: "none" }, label: "Задняя обложка", shift: 25 });
  return views;
}

// Книга с листанием. Состояние (какой разворот, идёт ли перелистывание) — у родителя: превью и «на весь экран» синхронны.
function Book({ views, ctx, view, flip, onFlipDone, onSwipe, ratio, big = false }) {
  const leaf = useRef(null);
  const shade = useRef(null);
  const swipe = useRef(null);

  useLayoutEffect(() => {
    if (!flip || !leaf.current) return;
    const deg = flip.dir > 0 ? -180 : 180;
    const easing = "cubic-bezier(0.3, 0.1, 0.25, 1)";
    const a = leaf.current.animate([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${deg}deg)` }], { duration: FLIP_MS, easing, fill: "forwards" });
    const s = shade.current?.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: FLIP_MS, easing });
    a.onfinish = () => onFlipDone(flip);
    return () => {
      a.onfinish = null;
      a.cancel();
      s?.cancel();
    };
  }, [flip, onFlipDone]);

  const target = flip ? flip.to : view;
  let left;
  let right;
  let front = null;
  let back = null;
  if (flip && flip.dir > 0) {
    left = views[flip.from].left;
    right = views[flip.to].right;
    front = views[flip.from].right;
    back = views[flip.to].left;
  } else if (flip) {
    left = views[flip.to].left;
    right = views[flip.from].right;
    front = views[flip.from].left;
    back = views[flip.to].right;
  } else {
    left = views[view].left;
    right = views[view].right;
  }
  const shift = views[target].shift || 0;

  return (
    <div
      className={"bk-stage" + (big ? " bk-big" : "")}
      style={{ "--bk-ar": ratio }}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        swipe.current = { x: e.clientX, y: e.clientY };
        // палец или мышь ушли за край книги — отпускание всё равно дойдёт сюда
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // старый браузер — без захвата, свайп внутри книги работает и так
        }
      }}
      onPointerUp={(e) => {
        const s = swipe.current;
        swipe.current = null;
        if (!s) return;
        const dx = e.clientX - s.x;
        const dy = e.clientY - s.y;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) onSwipe(dx < 0 ? 1 : -1);
      }}
      onPointerCancel={() => (swipe.current = null)}
    >
      <div className="bk-book" style={{ transform: `translateX(${shift}%)` }} data-view={target}>
        <div className="bk-half bk-left">
          <Face spec={left} ctx={ctx} side="left" />
        </div>
        <div className="bk-half bk-right">
          <Face spec={right} ctx={ctx} side="right" />
        </div>
        {flip && (
          <div key={`${flip.from}-${flip.to}`} ref={leaf} className={"bk-leaf " + (flip.dir > 0 ? "bk-leaf-fwd" : "bk-leaf-back")}>
            <div className="bk-face bk-front">
              <Face spec={front} ctx={ctx} side={flip.dir > 0 ? "right" : "left"} />
            </div>
            <div className="bk-face bk-back">
              <Face spec={back} ctx={ctx} side={flip.dir > 0 ? "left" : "right"} />
            </div>
            <div ref={shade} className="bk-shade" />
          </div>
        )}
      </div>
    </div>
  );
}

function Controls({ views, view, label, go, pages }) {
  return (
    <div className="bk-controls">
      <button type="button" className="btn btn-small bk-nav" data-dir="prev" onClick={() => go(-1)} disabled={view === 0} aria-label="Назад: предыдущий разворот">
        <IconLeft size={18} /> <span aria-hidden="true">Назад</span>
      </button>
      <div className="bk-count">
        <span aria-live="polite" aria-atomic="true" data-testid="book-position">
          {label}
        </span>
        {pages && <span className="muted small">стр. {pages.join(" и ")}</span>}
      </div>
      <button type="button" className="btn btn-small bk-nav" data-dir="next" onClick={() => go(1)} disabled={view >= views.length - 1} aria-label="Вперёд: следующий разворот">
        <span aria-hidden="true">Вперёд</span> <IconRight size={18} />
      </button>
    </div>
  );
}

export default function BookView({ layout, thumbs, size, issues, byId, book: rawBook, coverPhotoId, slotClass, placeStyle }) {
  const book = normBook(rawBook);
  const reduce = useReducedMotion();
  const views = bookViews(layout.pages.length);
  const [state, setState] = useState({ view: 0, flip: null });
  const last = views.length - 1;
  const view = Math.min(state.view, last);
  const flip = state.flip && state.flip.to <= last && state.flip.from <= last ? state.flip : null;
  const target = flip ? flip.to : view;
  const dialog = useRef(null);
  const opener = useRef(null);
  const [full, setFull] = useState(false);

  const go = useCallback(
    (d) => {
      setState((s) => {
        const from = s.flip ? s.flip.to : Math.min(s.view, last);
        const to = Math.max(0, Math.min(last, from + d));
        if (to === from) return s.flip ? { view: from, flip: null } : s;
        if (reduce) return { view: to, flip: null };
        return { view: from, flip: { from, to, dir: to > from ? 1 : -1 } };
      });
    },
    [last, reduce],
  );
  const onFlipDone = useCallback((f) => setState((s) => (s.flip === f ? { view: f.to, flip: null } : s)), []);

  // N7 D6: кнопка «Вперёд» на задней обложке (или «Назад» на обложке) станет недоступной — фокус заранее переводим
  // на книгу (в превью) или на соседнюю кнопку (на весь экран), иначе он упадёт на <body> и стрелки перестанут листать.
  // На книгу, а не на «Назад»: следующее Enter не перелистнёт неожиданно назад.
  const keepFocus = (to) => {
    const el = document.activeElement;
    const dir = el?.dataset?.dir;
    if (!((dir === "next" && to >= last) || (dir === "prev" && to <= 0))) return;
    const frame = el.closest("dialog") ? null : el.closest(".bk-wrap")?.querySelector(".bk-frame");
    (frame || el.closest(".bk-controls")?.querySelector(`[data-dir="${dir === "next" ? "prev" : "next"}"]`))?.focus();
  };
  const move = (d) => {
    keepFocus(Math.max(0, Math.min(last, target + d)));
    go(d);
  };
  const jump = (to) => {
    keepFocus(to);
    setState({ view: to, flip: null });
  };
  const handleNav = (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      jump(0);
    } else if (e.key === "End") {
      e.preventDefault();
      jump(last);
    }
  };
  // Стрелки, Home и End листают, где бы ни был фокус в превью (книга, «Вперёд»/«Назад», «180°»). Поля ввода и
  // открытый диалог обрабатывают клавиши сами.
  const onKey = (e) => {
    if (e.target.closest("input, textarea, select, dialog")) return;
    handleNav(e);
  };

  // Фокус не уходит из диалога: Tab с последней кнопки — на первую, Shift+Tab с первой — на последнюю
  const onDialogKey = (e) => {
    if (e.key === "Tab") {
      const els = [...dialog.current.querySelectorAll("button:not([disabled]), [tabindex='0']")];
      if (!els.length) return;
      const first = els[0];
      const lastEl = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    handleNav(e);
  };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (full && !d.open) d.showModal();
    if (!full && d.open) d.close();
  }, [full]);

  // N7 D3: «назад» браузера или жест «назад» закрывает книгу, а не уводит из редактора. При открытии — своя запись в
  // истории (тот же адрес); закрытие кнопкой или Esc эту запись убирает, поэтому лишних шагов «назад» не остаётся.
  const pushed = useRef(false);
  const openFull = () => {
    setFull(true);
    try {
      window.history.pushState({ bkFull: true }, "");
      pushed.current = true;
    } catch {
      pushed.current = false;
    }
  };
  useEffect(() => {
    if (!full) return;
    const onPop = () => {
      if (!pushed.current) return;
      pushed.current = false;
      setFull(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [full]);
  const vp = useViewport();

  const ctx = {
    layout,
    thumbs,
    byId,
    book,
    coverPhotoId,
    placeStyle,
    slotClass: (photoId) => slotClass(issues, photoId),
  };
  const ratio = (2 * size.w) / size.h;
  const v = views[target];
  const rotate = full && vp.coarse && vp.w < vp.h && bigBookHeight(vp.h, vp.w, ratio) > 1.15 * bigBookHeight(vp.w, vp.h, ratio);

  return (
    <section className="bk-wrap" aria-label="Превью книги" data-template={book.template} onKeyDown={onKey}>
      <div className="bk-frame" role="group" aria-roledescription="книга" aria-label="Книга: листайте стрелками влево и вправо или свайпом" tabIndex={0}>
        <Book views={views} ctx={ctx} view={view} flip={flip} onFlipDone={onFlipDone} onSwipe={go} ratio={ratio} />
      </div>
      <Controls views={views} view={target} label={v.label} pages={v.pages} go={move} />
      <div className="bk-open-row">
        <button type="button" ref={opener} className="btn btn-secondary bk-open" onClick={openFull}>
          <Icon180 size={22} /> Посмотреть книгу целиком
        </button>
      </div>
      <dialog
        ref={dialog}
        className="bk-dialog"
        aria-label="Книга целиком"
        onClose={() => {
          setFull(false);
          if (pushed.current) {
            pushed.current = false;
            if (window.history.state?.bkFull) window.history.back();
          }
          opener.current?.focus();
        }}
        onKeyDown={onDialogKey}
      >
        {full && (
          <div className="bk-dialog-body">
            <div className="bk-dialog-head">
              <b>Книга целиком</b>
              <button type="button" className="btn btn-small bk-close" onClick={() => setFull(false)} autoFocus aria-label="Закрыть">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
                <span className="bk-close-text" aria-hidden="true">
                  Закрыть
                </span>
              </button>
            </div>
            <div className="bk-dialog-main">
              <Book views={views} ctx={ctx} view={view} flip={flip} onFlipDone={onFlipDone} onSwipe={go} ratio={ratio} big />
            </div>
            <Controls views={views} view={target} label={v.label} pages={v.pages} go={move} />
            <div className="muted small bk-dialog-hints">
              <p className="bk-dialog-hint bk-hint-touch">Листайте свайпом или кнопками.</p>
              <p className="bk-dialog-hint bk-hint-keys">Листайте стрелками ← →, мышью или кнопками. Закрыть — Esc.</p>
              {rotate && <p className="bk-dialog-hint bk-rotate-hint">Поверните экран — книга станет крупнее.</p>}
            </div>
          </div>
        )}
      </dialog>
    </section>
  );
}

// Образец шаблона для выбора: страничка с двумя местами под фото, поля — как в автомакете
function TemplateSample({ tpl }) {
  const t = bookTemplate(tpl);
  const m = t.margin * 100;
  const g = t.gap * 100;
  const w = (100 - 2 * m - g) / 2;
  return (
    <span className={pageClass(tpl) + " bk-sample"} aria-hidden="true">
      <Decor tpl={tpl} />
      <span className="bk-slot" style={{ left: m + "%", top: m + "%", width: w + "%", height: 100 - 2 * m + "%" }} />
      <span className="bk-slot" style={{ left: m + w + g + "%", top: m + "%", width: w + "%", height: w + "%" }} />
      <span className="bk-slot" style={{ left: m + w + g + "%", top: m + w + g + "%", width: w + "%", height: 100 - 2 * m - w - g + "%" }} />
    </span>
  );
}

function CoverSample({ layout, tpl }) {
  return (
    <span className={pageClass(tpl) + " bk-sample bk-cover cover-" + layout} aria-hidden="true">
      {layout !== "title" && <span className="bk-cover-photo bk-sample-photo" />}
      <span className="bk-cover-text">
        <span className="bk-sample-line" />
        <span className="bk-sample-line short" />
      </span>
    </span>
  );
}

// Шаг «Автомакет»: шаблон оформления и обложка. Сохраняется в проекте (устройство → аккаунт → заказ).
export function BookDesign({ book: rawBook, readOnly }) {
  const season = useSeason();
  const book = normBook(rawBook);
  const hintId = useId();
  const title = rawBook?.cover?.title ?? "";
  const date = rawBook?.cover?.date ?? "";
  return (
    <div className="bk-design">
      <fieldset className="bk-pick" disabled={readOnly}>
        <legend>Оформление страниц</legend>
        <p className="muted small">Фон, рамки и поля страниц. Автомакет сам подвинет фото под выбранный шаблон.</p>
        <div className="bk-pick-grid">
          {templatesInOrder(season).map((t) => (
            <label key={t.id} className="bk-pick-item" data-template={t.id}>
              <input type="radio" name="bk-template" value={t.id} checked={book.template === t.id} onChange={() => setBook({ template: t.id })} />
              <TemplateSample tpl={t.id} />
              <b>{t.name}</b>
              <span className="bk-pick-hint">{t.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="bk-pick" disabled={readOnly}>
        <legend>Обложка</legend>
        <div className="field">
          <label>
            <span>Название</span>
            {/* N7 D7: длина — в знаках, которые видит человек (👨‍👩‍👧 — один знак); обрезает setBook, maxLength считал бы UTF-16 */}
            <input className="input" name="bk-title" value={title} placeholder="Например, Лето у бабушки" autoComplete="off" aria-describedby={hintId} onChange={(e) => setBook({ cover: { title: e.target.value } })} />
          </label>
          <small className="field-hint" id={hintId}>
            {textLength(title)} из {TITLE_MAX} знаков
          </small>
        </div>
        <label className="field">
          <span>Дата</span>
          <input className="input" name="bk-date" value={date} placeholder="Например, август 2026" autoComplete="off" onChange={(e) => setBook({ cover: { date: e.target.value } })} />
        </label>
        <div className="bk-pick-grid bk-cover-grid" role="radiogroup" aria-label="Расположение на обложке">
          {COVER_LAYOUTS.map((c) => (
            <label key={c.id} className="bk-pick-item" data-cover={c.id}>
              <input type="radio" name="bk-cover" value={c.id} checked={book.cover.layout === c.id} onChange={() => setBook({ cover: { layout: c.id } })} />
              <CoverSample layout={c.id} tpl={book.template} />
              <b>{c.name}</b>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
