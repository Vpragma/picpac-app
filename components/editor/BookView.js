"use client";
// Превью фотокниги «как настоящая» (N11): обложка, развороты, задняя обложка; перелистывание с 3D-эффектом
// (только transform и opacity, при prefers-reduced-motion — без анимации), свайп на телефоне, стрелки клавиатуры
// и кнопки на компьютере, «Разворот N из M» для экранного диктора. Кнопка с иконкой «180°» — книга на весь экран
// (<dialog>: фокус внутри, Esc закрывает, фокус возвращается на кнопку).
// Шаблоны оформления и обложка — lib/book.js; выбор — BookDesign (шаг «Автомакет»). Стили — app/editor/book.css.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconLeft, IconRight } from "../icons";
import { ART_SVG, Leaf, Maple, Oak } from "../season/SeasonArt";
import { COVER_LAYOUTS, DATE_MAX, TITLE_MAX, bookTemplate, normBook, templatesInOrder } from "../../lib/book";
import { setBook } from "../../lib/draft";
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
          {/* eslint-disable-next-line @next/next/no-img-element -- фото клиента с устройства (blob:/data:): next/image их не оптимизирует */}
          {ctx.thumbs[sl.photoId] && <img src={ctx.thumbs[sl.photoId]} alt="" draggable={false} style={ctx.placeStyle(ctx.byId[sl.photoId])} />}
        </div>
      ))}
    </div>
  );
}

function Cover({ ctx, cls }) {
  const { title, date, layout } = ctx.book.cover;
  const id = ctx.coverPhotoId;
  const src = id && ctx.thumbs[id];
  return (
    <div className={cls + " bk-cover cover-" + layout} data-cover-layout={layout}>
      <Decor tpl={ctx.book.template} where="cover" />
      {layout !== "title" && (
        <div className="bk-cover-photo">
          {/* eslint-disable-next-line @next/next/no-img-element -- фото клиента с устройства */}
          {src && <img src={src} alt="" draggable={false} style={ctx.placeStyle(ctx.byId[id])} />}
        </div>
      )}
      {(title || date) && (
        <div className="bk-cover-text">
          {title && <b className="bk-cover-title">{title}</b>}
          {date && <span className="bk-cover-date">{date}</span>}
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
      <button type="button" className="btn btn-small bk-nav" onClick={() => go(-1)} disabled={view === 0} aria-label="Назад: предыдущий разворот">
        <IconLeft size={18} /> <span aria-hidden="true">Назад</span>
      </button>
      <div className="bk-count">
        <span aria-live="polite" aria-atomic="true" data-testid="book-position">
          {label}
        </span>
        {pages && <span className="muted small">стр. {pages.join(" и ")}</span>}
      </div>
      <button type="button" className="btn btn-small bk-nav" onClick={() => go(1)} disabled={view >= views.length - 1} aria-label="Вперёд: следующий разворот">
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

  const onKey = (e) => {
    if (e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setState({ view: 0, flip: null });
    } else if (e.key === "End") {
      e.preventDefault();
      setState({ view: last, flip: null });
    }
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
    onKey(e);
  };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (full && !d.open) d.showModal();
    if (!full && d.open) d.close();
  }, [full]);

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

  return (
    <section className="bk-wrap" aria-label="Превью книги" data-template={book.template}>
      <div className="bk-frame" role="group" aria-roledescription="книга" aria-label="Книга: листайте стрелками влево и вправо или свайпом" tabIndex={0} onKeyDown={onKey}>
        <Book views={views} ctx={ctx} view={view} flip={flip} onFlipDone={onFlipDone} onSwipe={go} ratio={ratio} />
      </div>
      <Controls views={views} view={target} label={v.label} pages={v.pages} go={go} />
      <div className="bk-open-row">
        <button type="button" ref={opener} className="btn btn-secondary bk-open" onClick={() => setFull(true)}>
          <Icon180 size={22} /> Посмотреть книгу целиком
        </button>
      </div>
      <dialog
        ref={dialog}
        className="bk-dialog"
        aria-label="Книга целиком"
        onClose={() => {
          setFull(false);
          opener.current?.focus();
        }}
        onKeyDown={onDialogKey}
      >
        {full && (
          <div className="bk-dialog-body">
            <div className="bk-dialog-head">
              <b>Книга целиком</b>
              <button type="button" className="btn btn-small" onClick={() => setFull(false)} autoFocus>
                Закрыть
              </button>
            </div>
            <Book views={views} ctx={ctx} view={view} flip={flip} onFlipDone={onFlipDone} onSwipe={go} ratio={ratio} big />
            <Controls views={views} view={target} label={v.label} pages={v.pages} go={go} />
            <p className="muted small bk-dialog-hint">Листайте свайпом, стрелками или кнопками. Закрыть — Esc.</p>
            <p className="muted small bk-dialog-hint bk-rotate-hint">Поверните телефон — книга станет крупнее.</p>
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
            <input className="input" name="bk-title" value={title} maxLength={TITLE_MAX} placeholder="Например, Лето у бабушки" autoComplete="off" aria-describedby={hintId} onChange={(e) => setBook({ cover: { title: e.target.value } })} />
          </label>
          <small className="field-hint" id={hintId}>
            {Array.from(title).length} из {TITLE_MAX} знаков
          </small>
        </div>
        <label className="field">
          <span>Дата</span>
          <input className="input" name="bk-date" value={date} maxLength={DATE_MAX} placeholder="Например, август 2026" autoComplete="off" onChange={(e) => setBook({ cover: { date: e.target.value } })} />
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
