"use client";
// Шаг «Правки»: ИИ-редактор фото (S03a–b). Загружается только при открытии шага (next/dynamic в app/editor/page.js).
//
// Как устроено:
// - правки неразрушающие: в проекте хранится photo.edits (lib/photo/adjust.js), оригинал не меняется;
// - превью: оригинал из IndexedDB уменьшается до ≤ 1280 точек, пиксели правятся таблицами (canvas 2D), «до» — второй слой;
// - команды разбирает словарь на устройстве (lib/photo/commands.js); местные правки (размыть фон, убрать) — S03c,
//   их обработчики добавляются в LOCAL_ACTIONS ниже;
// - история шагов — в памяти редактора (кнопка «Отменить»), каждый шаг сразу сохраняется в черновике.
import { useEffect, useRef, useState } from "react";
import { getPhotoBlob, mapDraftPhotos, setPhotoEdits } from "../../lib/draft";
import { ADJUST_KEYS, ADJUST_LABELS, addManual, applyEdits, emptyEdits, hasAuto, hasManual, normEdits, setManual } from "../../lib/photo/adjust";
import { autoParams } from "../../lib/photo/analyze";
import { SUGGESTIONS, parseCommand } from "../../lib/photo/commands";
import { photoBadges } from "../../lib/photo/badges";
import { setAutoEnhance, useAutoEnhance } from "../../lib/photo/settings";
import { notify } from "../../lib/store";

const PREVIEW_SIDE = 1280;

// Местные правки по маске — делает S03c (SlimSAM, ластик, размытие фона). Пока — честный ответ, не молчание.
const LOCAL_ACTIONS = {
  blurBackground: () => ({ say: "Размытие фона появится вместе с выделением касанием — скоро. Сейчас работают свет и цвет: «ярче», «теплее», «убери пересвет»." }),
  remove: (step) => ({
    say: `Убрать ${step.target === "sun" ? "солнце" : step.target === "glare" ? "блики" : "«" + step.target + "»"} пока не умею — ластик появится вместе с выделением касанием. Сейчас работают свет и цвет: «ярче», «теплее», «убери пересвет».`,
  }),
  creative: () => ({ say: "Творческие правки (небо, снег) появятся в облачном редакторе. Сейчас работают свет и цвет: «ярче», «теплее», «убери пересвет»." }),
};

// Кэш уменьшенных оригиналов (ImageData) — последние 4 фото
const cache = new Map();
async function loadSource(id, thumbUrl) {
  if (cache.has(id)) return cache.get(id);
  let blob = await getPhotoBlob(id).catch(() => null);
  if (!blob && thumbUrl) blob = await fetch(thumbUrl).then((r) => r.blob());
  if (!blob) throw new Error("Нет файла фото на устройстве");
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, PREVIEW_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  cache.set(id, img);
  if (cache.size > 4) cache.delete(cache.keys().next().value);
  return img;
}

export default function PhotoEditor({ draft, thumbs, readOnly, lowDpiIds, dupIds, extra }) {
  const usable = draft.photos.filter((p) => p.supported);
  const [sel, setSel] = useState(usable[0]?.id || null);
  const photo = usable.find((p) => p.id === sel) || usable[0];
  const autoOn = useAutoEnhance();
  const [live, setLive] = useState(null); // правки во время движения ползунка (ещё не сохранены)
  const [history, setHistory] = useState({}); // id фото → прежние правки (для «Отменить»)
  const [answer, setAnswer] = useState(null);
  const [cmd, setCmd] = useState("");
  const [last, setLast] = useState(null);

  if (!photo) return <p className="muted">Добавьте фото — здесь можно будет улучшить их командой или ползунками.</p>;

  const saved = normEdits(photo.edits);
  const edits = live && live.id === photo.id ? live.edits : saved;
  const past = history[photo.id] || [];
  const autoProblems = (photo.quality?.problems || []).filter((p) => p === "dark" || p === "bright" || p === "cast" || p === "flat");

  function choose(id) {
    if (live && live.id === photo.id) commit(live.edits); // ползунок двигали, но не отпустили — не теряем
    setSel(id);
    setLive(null);
    setAnswer(null);
  }

  // Шаг правки: запомнить прежнее (для «Отменить») и сразу сохранить в черновике
  function commit(next) {
    if (readOnly) return;
    setHistory((h) => ({ ...h, [photo.id]: [...(h[photo.id] || []), saved].slice(-30) }));
    setPhotoEdits(photo.id, next);
    setLive(null);
  }

  function undo() {
    if (!past.length) return setAnswer({ ok: false, say: "Отменять нечего — это исходное состояние." });
    const prev = past[past.length - 1];
    setHistory((h) => ({ ...h, [photo.id]: past.slice(0, -1) }));
    setPhotoEdits(photo.id, prev);
    setLive(null);
    setAnswer({ ok: true, say: "Отменили последний шаг" });
  }

  function resetOriginal() {
    commit({ ...emptyEdits(), auto: saved.auto, autoOff: true });
    setAnswer({ ok: true, say: "Вернули оригинал. «Отменить» вернёт правки." });
  }

  function toggleAuto(on) {
    commit({ ...saved, autoOff: !on });
    setAnswer({ ok: true, say: on ? "Улучшение вернули" : "Улучшение отменили — фото как было" });
  }

  function run(text) {
    if (readOnly) return;
    const r = parseCommand(text, { last });
    if (!r.ok) return setAnswer({ ok: false, say: r.say });
    let next = saved;
    const said = [];
    for (const step of r.steps) {
      if (step.kind === "adjust") {
        next = addManual(next, step.deltas, "command");
        setLast(step);
        said.push(step.say);
      } else if (step.kind === "auto") {
        const m = photo.quality?.metrics;
        if (!m) {
          said.push("Ещё смотрим фото — повторите через секунду");
          continue;
        }
        next = { ...next, auto: autoParams(m, { force: true }), autoOff: false };
        said.push(step.say);
      } else if (step.kind === "undo") {
        return undo();
      } else if (step.kind === "reset") {
        return resetOriginal();
      } else {
        const handler = LOCAL_ACTIONS[step.kind];
        const res = handler ? handler(step, { photo }) : { say: "Пока не умею. Попробуйте: «ярче», «теплее», «убери пересвет»." };
        said.push(res.say);
      }
    }
    if (next !== saved) commit(next);
    setAnswer({ ok: next !== saved, say: said.join(". ") });
    setCmd("");
  }

  function cancelAll() {
    mapDraftPhotos((p) => (p.edits?.auto ? { ...p, edits: { ...normEdits(p.edits), autoOff: true } } : p));
    setHistory({});
    setAnswer({ ok: true, say: "Все автоматические улучшения отменены" });
    notify("Все улучшения отменены — фото как были", "info");
  }

  function setAutoSetting(on) {
    setAutoEnhance(on);
    // Включили — улучшить уже проверенные плохие фото; выключили — отменить автоулучшения в этом проекте
    mapDraftPhotos((p) => {
      const ed = normEdits(p.edits);
      if (!on) return ed.auto ? { ...p, edits: { ...ed, autoOff: true } } : p;
      const auto = ed.auto || (p.quality?.metrics ? autoParams(p.quality.metrics) : null);
      return auto ? { ...p, edits: { ...ed, auto, autoOff: false } } : p;
    });
  }

  const badges = photoBadges({ ...photo, edits }, { lowDpi: lowDpiIds?.has(photo.id), duplicate: dupIds?.has(photo.id) });
  const enhanced = hasAuto(edits);

  return (
    <div className="pe">
      <p className="muted">Скажите, что изменить, или подвигайте ползунки — оригинал не меняется, всё можно вернуть.</p>
      <div className="pe-strip" role="list" aria-label="Фото проекта">
        {usable.map((p, i) => {
          const b = photoBadges(p, { lowDpi: lowDpiIds?.has(p.id), duplicate: dupIds?.has(p.id) });
          return (
            <div role="listitem" key={p.id}>
              <button className={"photo-cell" + (p.id === photo.id ? " selected" : "")} onClick={() => choose(p.id)} aria-pressed={p.id === photo.id} aria-label={`Фото ${i + 1}: ${p.name}${b.length ? " — " + b.map((x) => x.label).join(", ") : ""}`} data-edit-photo={p.name}>
                {thumbs[p.id] && <img src={thumbs[p.id]} alt="" />}
                <Badges list={b} compact />
              </button>
            </div>
          );
        })}
      </div>

      <div className="card pe-main">
        <div className="row between wrap" style={{ gap: 8 }}>
          <b className="pe-name">{photo.name}</b>
          <Badges list={badges} />
        </div>
        <Preview key={photo.id} photo={photo} thumb={thumbs[photo.id]} edits={edits} />

        {enhanced && (
          <p className="small pe-note">
            <b>Улучшено автоматически:</b> {autoProblems.includes("dark") ? "фото было тёмным — добавили света в тенях. " : ""}
            {autoProblems.includes("bright") ? "фото было пересвечено — приглушили светлые участки. " : ""}
            {autoProblems.includes("cast") ? "убрали цветовой оттенок. " : ""}
            {autoProblems.includes("flat") ? "добавили контраста. " : ""}
            <button className="btn btn-small" onClick={() => toggleAuto(false)} disabled={readOnly}>
              Отменить улучшение
            </button>
          </p>
        )}
        {!enhanced && saved.auto && saved.autoOff && (
          <p className="small pe-note">
            Автоулучшение этого фото отменено.{" "}
            <button className="btn btn-small" onClick={() => toggleAuto(true)} disabled={readOnly}>
              Вернуть улучшение
            </button>
          </p>
        )}

        <form
          className="pe-cmd"
          onSubmit={(e) => {
            e.preventDefault();
            run(cmd);
          }}
        >
          <label htmlFor="pe-cmd" className="pe-label">
            Что изменить?
          </label>
          <div className="row" style={{ gap: 8 }}>
            <input id="pe-cmd" className="input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Например: сделай ярче и чуть теплее" disabled={readOnly} autoComplete="off" enterKeyHint="done" />
            <button type="submit" className="btn btn-primary" disabled={readOnly}>
              Сделать
            </button>
          </div>
          <div className="pe-chips" aria-label="Подсказки">
            {SUGGESTIONS.map((s) => (
              <button type="button" key={s} className="btn btn-small" onClick={() => run(s)} disabled={readOnly}>
                {s}
              </button>
            ))}
          </div>
          <p className={"small pe-answer" + (answer && !answer.ok ? " warn-text" : "")} role="status" aria-live="polite">
            {answer?.say || ""}
          </p>
        </form>

        <div className="pe-sliders">
          {ADJUST_KEYS.map((k) => {
            const v = Math.round(edits.manual[k] || 0);
            return (
              <label key={k} className="pe-slider">
                <span className="row between">
                  <span>{ADJUST_LABELS[k]}</span>
                  <output className="muted small">{v > 0 ? "+" + v : v}</output>
                </span>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={v}
                  disabled={readOnly}
                  aria-label={ADJUST_LABELS[k]}
                  onChange={(e) => setLive({ id: photo.id, edits: setManual(edits, k, Number(e.target.value)) })}
                  onPointerUp={() => live && commit(live.edits)}
                  onKeyUp={() => live && commit(live.edits)}
                  onBlur={() => live && commit(live.edits)}
                />
              </label>
            );
          })}
        </div>

        <div className="row wrap pe-actions">
          <button className="btn" onClick={undo} disabled={readOnly || !past.length}>
            Отменить
          </button>
          <button className="btn" onClick={resetOriginal} disabled={readOnly || (!hasAuto(saved) && !hasManual(saved))}>
            Вернуть оригинал
          </button>
          <button
            className="btn btn-primary"
            disabled={readOnly}
            onClick={() => {
              if (live) commit(live.edits);
              const i = usable.findIndex((p) => p.id === photo.id);
              notify("Правки сохранены в черновике", "success");
              if (i < usable.length - 1) choose(usable[i + 1].id);
            }}
          >
            Применить
          </button>
        </div>
      </div>

      {extra?.(photo)}

      <div className="card">
        <label className="row between pe-switch">
          <span>
            <b>Улучшать автоматически</b>
            <span className="muted small" style={{ display: "block" }}>
              Тёмные, пересвеченные и «цветные» фото поправим мягко. Хорошие не трогаем.
            </span>
          </span>
          <input type="checkbox" role="switch" checked={autoOn} onChange={(e) => setAutoSetting(e.target.checked)} disabled={readOnly} />
        </label>
        <button className="btn btn-small" onClick={cancelAll} disabled={readOnly || !usable.some((p) => hasAuto(p.edits))} style={{ marginTop: 8 }}>
          Отменить все улучшения
        </button>
        <p className="muted small" style={{ marginTop: 8 }}>
          Честно о пределах: полностью белые участки не восстановить, сильную размытость не исправить. Если фото будет плохо смотреться в печати — предупредим на шаге «Проверка».
        </p>
        {photo.quality?.metrics && <QualityLine q={photo.quality} />}
      </div>
    </div>
  );
}

export function Badges({ list, compact }) {
  if (!list?.length) return null;
  return (
    <span className={"pe-badges" + (compact ? " compact" : "")}>
      {list.map((b) => (
        <span key={b.id} className={"pe-badge " + b.tone} data-badge={b.id} title={b.label}>
          {compact && b.short ? b.short : b.label}
        </span>
      ))}
    </span>
  );
}

function QualityLine({ q }) {
  const m = q.metrics;
  const pct = (v) => Math.round(v * 100) + "%";
  return (
    <p className="muted small">
      Оценка качества: {q.score}/100 · яркость {pct(m.mean)} · пересвет {pct(m.clipHigh)} · провалы в тень {pct(m.clipLow)} · контраст {pct(m.contrast)} · резкость {Math.round(m.sharpness)} · шум {m.noise}
    </p>
  );
}

// Превью: «после» — canvas с правками, «до» — второй canvas поверх (ползунок или удержание)
function Preview({ photo, thumb, edits }) {
  const photoId = photo.id;
  const afterRef = useRef(null);
  const beforeRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(0);
  const [hold, setHold] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    let alive = true;
    loadSource(photoId, thumb)
      .then((img) => alive && setSrc(img))
      .catch((e) => {
        console.error(e);
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [photoId, thumb]);

  // «До» рисуем один раз
  useEffect(() => {
    if (!src || !beforeRef.current) return;
    const c = beforeRef.current;
    c.width = src.width;
    c.height = src.height;
    c.getContext("2d").putImageData(src, 0, 0);
  }, [src]);

  // «После» — с правками; частые изменения ползунка склеиваем
  const key = JSON.stringify(edits);
  useEffect(() => {
    if (!src || !afterRef.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const c = afterRef.current;
      if (!c) return;
      if (c.width !== src.width || c.height !== src.height) {
        c.width = src.width;
        c.height = src.height;
      }
      const out = new ImageData(src.width, src.height);
      applyEdits(src.data, out.data, JSON.parse(key));
      c.getContext("2d").putImageData(out, 0, 0);
      c.dataset.rendered = key;
    }, 0);
    return () => clearTimeout(timer.current);
  }, [src, key]);

  const shown = hold ? 100 : split;
  const holdOn = () => setHold(true);
  const holdOff = () => setHold(false);
  if (failed) return <p className="err-text small">Не получилось открыть фото на этом устройстве. Попробуйте перезагрузить страницу.</p>;
  return (
    <div className="pe-preview">
      <div className="pe-stage" onPointerDown={holdOn} onPointerUp={holdOff} onPointerLeave={holdOff} onPointerCancel={holdOff} data-compare={shown}>
        {!src && <div className="pe-loading muted small">Открываем фото…</div>}
        <canvas ref={afterRef} className="pe-after" aria-label={"Фото после правок: " + photo.name} role="img" />
        <canvas ref={beforeRef} className="pe-before" style={{ clipPath: `inset(0 ${100 - shown}% 0 0)` }} aria-hidden="true" />
        {shown > 0 && shown < 100 && <span className="pe-divider" style={{ left: shown + "%" }} aria-hidden="true" />}
        {shown > 0 && <span className="pe-tag left">До</span>}
        {shown < 100 && <span className="pe-tag right">После</span>}
      </div>
      <div className="row wrap pe-compare">
        <button
          type="button"
          className="btn btn-small"
          aria-pressed={hold}
          onPointerDown={holdOn}
          onPointerUp={holdOff}
          onPointerLeave={holdOff}
          onKeyDown={(e) => (e.key === " " || e.key === "Enter") && holdOn()}
          onKeyUp={holdOff}
          onBlur={holdOff}
        >
          Удерживайте — оригинал
        </button>
        <label className="pe-compare-range">
          <span className="small">До / после</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="До / после: сколько показать оригинала слева" />
        </label>
      </div>
    </div>
  );
}
