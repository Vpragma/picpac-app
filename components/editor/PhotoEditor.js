"use client";
// Шаг «Правки»: ИИ-редактор фото (S03a–b). Загружается только при открытии шага (next/dynamic в app/editor/page.js).
//
// Как устроено:
// - правки неразрушающие: в проекте хранится photo.edits (lib/photo/adjust.js), оригинал не меняется;
// - превью: оригинал из IndexedDB уменьшается до ≤ 1280 точек, пиксели правятся таблицами (canvas 2D), «до» — второй слой;
// - команды разбирает словарь на устройстве (lib/photo/commands.js); «убери солнце» — без нейросети (lib/photo/local.js);
// - D1: выделение касанием (SlimSAM в воркере, lib/photo/ai.js) → «Размыть фон», «Осветлить», «Затемнить», «Убрать»
//   (ластик MI-GAN). Правка хранит маску (lib/photo/mask.js), превью и печать считают её одинаково;
//   ластик — до света и цвета (результат кэшируется), остальное — после;
// - D1: «Резкость для печати» ×2 (UpscalerJS, lib/photo/upscale.js) для фото, которым не хватает точек;
// - история шагов — в памяти редактора (кнопка «Отменить»), каждый шаг сразу сохраняется в черновике.
import { useEffect, useRef, useState } from "react";
import { getPhotoBlob, kvSet, mapDraftPhotos, setPhotoEdits } from "../../lib/draft";
import { ADJUST_KEYS, ADJUST_LABELS, addManual, applyEdits, compactEdits, emptyEdits, hasAuto, hasManual, normEdits, setManual } from "../../lib/photo/adjust";
import { autoParams } from "../../lib/photo/analyze";
import { SUGGESTIONS, parseCommand } from "../../lib/photo/commands";
import { photoBadges } from "../../lib/photo/badges";
import { applyOps, findSun } from "../../lib/photo/local";
import { MAX_MASK_OPS, eraseKey, makeMaskOp, maskArea, splitOps } from "../../lib/photo/mask";
import { aiSupport, embedImage, eraseImage, isCancelled, segmentPoints, stopAi } from "../../lib/photo/ai";
import { UPSCALE_MAX_SIDE, stopUpscale, upscaleBlob, upscaleKey } from "../../lib/photo/upscale";
import { setAutoEnhance, useAutoEnhance } from "../../lib/photo/settings";
import { notify } from "../../lib/store";
import { track } from "@/lib/analytics";

const PREVIEW_SIDE = 1280;

// Местные правки без выделения. «Убери солнце/блики» — поиск самой яркой компактной области и заливка
// (lib/photo/local.js), правка — в edits.ops. Правки по выделению касанием — maskStep() в редакторе.
const LOCAL_ACTIONS = {
  remove: (step, { photo, edits }) => {
    if (step.target === "sun" || step.target === "glare") {
      const what = step.target === "sun" ? "солнце" : "блик";
      const img = cache.get(photo.id);
      if (!img) return { say: "Ещё открываем фото — повторите через секунду" };
      const op = findSun(img.data, img.width, img.height, step.target === "glare" ? { minCore: 0 } : undefined);
      if (!op)
        return {
          say:
            step.target === "sun"
              ? "Не нашёл солнце на этом фото — ничего не меняю. Если небо слишком светлое, попробуйте «убери пересвет»."
              : "Не нашёл бликов на этом фото — ничего не меняю. Попробуйте «убери пересвет».",
        };
      const side = Math.max(img.width, img.height);
      const twice = (edits.ops || []).some((o) => o.kind === "heal" && Math.hypot((o.cx - op.cx) * img.width, (o.cy - op.cy) * img.height) < o.r * side);
      if (twice) return { say: `${what[0].toUpperCase() + what.slice(1)} уже убрано. «Отменить» вернёт как было.` };
      return { say: step.target === "sun" ? "Убрали солнце" : "Убрали блик", edits: { ...edits, ops: [...(edits.ops || []), op], by: "command" } };
    }
    return { say: "Пока не умею. Попробуйте: «ярче», «теплее», «убери пересвет»." };
  },
  keep: (step) => ({ say: step.say }),
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

// Ластик (D1): результат «Убрать» для превью считается в воркере один раз и кэшируется по набору правок
const erasedCache = new Map();
const erasing = new Map();
function ensureErased(photoId, src, eraseOps, onProgress) {
  if (!eraseOps.length) return Promise.resolve(src);
  const key = eraseKey(photoId, eraseOps);
  if (erasedCache.has(key)) return Promise.resolve(erasedCache.get(key));
  if (!erasing.has(key)) {
    const p = eraseImage(src, eraseOps, onProgress).then(
      (img) => {
        erasedCache.set(key, img);
        if (erasedCache.size > 4) erasedCache.delete(erasedCache.keys().next().value);
        erasing.delete(key);
        return img;
      },
      (e) => {
        erasing.delete(key);
        throw e;
      },
    );
    erasing.set(key, p);
  }
  return erasing.get(key);
}

// Уменьшить ImageData до side по длинной стороне (для кодировщика SlimSAM — 1024)
function toSide(img, side) {
  const k = Math.min(1, side / Math.max(img.width, img.height));
  if (k === 1) return img;
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const a = document.createElement("canvas");
  a.width = img.width;
  a.height = img.height;
  a.getContext("2d").putImageData(img, 0, 0);
  const b = document.createElement("canvas");
  b.width = w;
  b.height = h;
  const ctx = b.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(a, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

const MASK_SAY = { blurBg: "Размыли фон — главное осталось чётким", lighten: "Осветлили выделенное", darken: "Затемнили выделенное", erase: "Убираем выделенное…" };
const AI_OFF = { status: "off" };

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
  // Выделение касанием (D1): { status: off|loading|ready|unsupported|error, photoId, key, w, h, points, mask, add, pending, shown }
  const [ai, setAiState] = useState(AI_OFF);
  const aiRef = useRef(AI_OFF);
  const segN = useRef(0);
  const [up, setUp] = useState(null); // «Резкость для печати»: { photoId, status: run|error, p, say }

  // Память воркеров ИИ освобождаем, когда редактор закрыт
  useEffect(
    () => () => {
      stopAi();
      stopUpscale();
    },
    [],
  );

  if (!photo) return <p className="muted">Добавьте фото — здесь можно будет улучшить их командой или ползунками.</p>;

  const saved = normEdits(photo.edits);
  const edits = live && live.id === photo.id ? live.edits : saved;
  const past = history[photo.id] || [];
  const autoProblems = (photo.quality?.problems || []).filter((p) => p === "dark" || p === "bright" || p === "cast" || p === "flat");
  const curKey = eraseKey(photo.id, splitOps(saved.ops).erase);
  // Выделение действует только для этого фото и этого набора «Убрать» (после ластика фото другое — выделять заново)
  const aiOn = ai.status !== "off" && ai.photoId === photo.id && (ai.status !== "ready" || ai.key === curKey);
  const mask = aiOn && ai.status === "ready" ? ai.mask : null;
  const hasMask = !!(mask && maskArea(mask.bits));

  function setAi(next) {
    aiRef.current = typeof next === "function" ? next(aiRef.current) : next;
    setAiState(aiRef.current);
  }

  function choose(id) {
    if (live && live.id === photo.id) commit(live.edits); // ползунок двигали, но не отпустили — не теряем
    setSel(id);
    setLive(null);
    setAnswer(null);
    if (aiRef.current.status === "loading") stopAi();
    setAi(AI_OFF);
  }

  // ---------- Выделение касанием ----------

  async function startSelect(pending = null) {
    if (readOnly) return;
    const sup = aiSupport();
    if (!sup.ok) return setAi({ status: "unsupported", photoId: photo.id, say: sup.say });
    const a = aiRef.current;
    if (a.status === "ready" && a.photoId === photo.id && a.key === curKey) return setAi({ ...a, pending });
    if (a.status === "loading" && a.photoId === photo.id && a.key === curKey) return setAi({ ...a, pending });
    const key = curKey;
    const pid = photo.id;
    const eraseOps = splitOps(saved.ops).erase;
    setAi({ status: "loading", photoId: pid, key, stage: "load", p: 0, points: [], mask: null, add: true, pending, shown: true });
    try {
      const src = await loadSource(pid, thumbs[pid]);
      const base = await ensureErased(pid, src, eraseOps);
      const r = await embedImage(key, toSide(base, 1024), (m) => setAi((b) => (b.key === key && b.status === "loading" ? { ...b, stage: m.stage, p: m.p } : b)));
      setAi((b) => (b.key === key && b.photoId === pid ? { ...b, status: "ready", w: r.w, h: r.h } : b));
    } catch (e) {
      if (isCancelled(e)) return;
      console.error(e, e?.workerStack || "");
      setAi((b) => (b.key === key ? { status: "error", photoId: pid, say: "Не получилось подготовить выделение. Попробуйте ещё раз — или пользуйтесь командами и ползунками." } : b));
    }
  }

  function cancelSelect() {
    stopAi();
    setAi(AI_OFF);
  }

  async function segment(points) {
    const a = aiRef.current;
    const n = ++segN.current;
    if (!points.length) return setAi({ ...a, points, mask: null, busy: false });
    setAi({ ...a, points, busy: true, shown: true });
    try {
      const r = await segmentPoints(a.key, points);
      if (n !== segN.current) return;
      setAi((b) => (b.key === a.key ? { ...b, mask: { bits: r.mask, w: r.w, h: r.h }, busy: false } : b));
    } catch (e) {
      if (isCancelled(e) || n !== segN.current) return;
      console.error(e);
      setAi((b) => ({ ...b, busy: false }));
      setAnswer({ ok: false, say: "Не получилось выделить. Коснитесь ещё раз." });
    }
  }

  function tap(u, v) {
    const a = aiRef.current;
    if (a.status !== "ready" || a.photoId !== photo.id) return;
    const add = a.points.length === 0 ? true : a.add; // первая точка — всегда «это предмет»
    segment([...a.points, { x: u * a.w, y: v * a.h, add }]);
  }

  // Сколько займут правки всех фото проекта в настройках (сервер принимает до 50 КБ)
  function editsSize(next) {
    let n = 0;
    for (const p of draft.photos) n += JSON.stringify(compactEdits(p.id === photo.id ? next : p.edits) || "").length;
    return n;
  }

  // Правка по выделению поверх base (правки фото) → { edits, say } или { say } без правки
  function maskStep(act, base) {
    if (!hasMask) {
      startSelect(act);
      const what = act === "blurBg" ? "главного на фото — того, что должно остаться чётким" : act === "erase" ? "того, что убрать" : "того, что изменить";
      const btn = { blurBg: "Размыть фон", lighten: "Осветлить", darken: "Затемнить", erase: "Убрать" }[act];
      return { say: `Коснитесь ${what}, затем нажмите «${btn}».` };
    }
    const ops = base.ops || [];
    if (ops.filter((o) => o.kind === "mask").length >= MAX_MASK_OPS)
      return { say: `Для одного фото — не больше ${MAX_MASK_OPS} правок по выделению. «Отменить» или «Вернуть оригинал» освободят место.` };
    const op = makeMaskOp(act, mask.bits, mask.w, mask.h);
    const next = { ...base, ops: [...ops, op], by: "command" };
    if (editsSize(next) > 45_000) return { say: "В проекте уже очень много правок по выделению. Отмените часть — и можно продолжить." };
    track("ai_edit", { props: { kind: "local" } });
    if (act === "erase") setAi(AI_OFF); // предмет убран — выделять нужно заново
    else setAi((b) => ({ ...b, pending: null, shown: false }));
    return { edits: next, say: MASK_SAY[act] };
  }

  function applyMask(act) {
    if (readOnly) return;
    const r = maskStep(act, saved);
    if (r.edits) commit(r.edits);
    setAnswer({ ok: !!r.edits, say: r.say });
  }

  // ---------- Резкость для печати ----------

  async function runUpscale() {
    if (readOnly) return;
    const pid = photo.id;
    setUp({ photoId: pid, status: "run", p: 0 });
    try {
      const blob = await getPhotoBlob(pid);
      if (!blob) throw new Error("Нет файла фото на устройстве");
      const r = await upscaleBlob(blob, (p) => setUp((u) => (u?.photoId === pid ? { ...u, p } : u)));
      await kvSet(upscaleKey(pid), r.blob);
      setPhotoEdits(pid, { ...normEdits(photo.edits), upscale: 2, by: "command" });
      setHistory((h) => ({ ...h, [pid]: [...(h[pid] || []), saved].slice(-30) }));
      track("ai_edit", { props: { kind: "local" } });
      setUp(null);
      setAnswer({ ok: true, say: `Резкость для печати включена: ${r.width / 2}×${r.height / 2} → ${r.width}×${r.height} точек. Оригинал не изменился.` });
    } catch (e) {
      if (e?.message === "cancelled") return setUp(null);
      if (e?.message !== "no_webgl") console.error(e); // без WebGL — не ошибка, а честный отказ
      setUp({
        photoId: pid,
        status: "error",
        say: e?.message === "no_webgl" ? "На этом устройстве нет WebGL — резкость для печати недоступна. Лучше взять оригинал фото, не из мессенджера." : "Не получилось сделать резче. Попробуйте ещё раз.",
      });
    }
  }

  function removeUpscale() {
    const next = { ...saved };
    delete next.upscale;
    commit(next);
    setAnswer({ ok: true, say: "Резкость для печати выключена — напечатаем оригинал." });
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
    track("ai_edit", { props: { kind: "command" } });
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
      } else if (step.kind === "blurBackground" || step.kind === "maskTone" || (step.kind === "remove" && step.target !== "sun" && step.target !== "glare")) {
        // D1: правки по выделению касанием. «Убери машину»: детектора на устройстве нет — если предмет уже
        // выделен касанием, убираем выделенное, иначе просим коснуться его (облачный поиск — этап D6)
        const act = step.kind === "blurBackground" ? "blurBg" : step.kind === "maskTone" ? (step.dir > 0 ? "lighten" : "darken") : "erase";
        if (act === "erase" && !hasMask && step.target !== "selection") {
          startSelect("erase");
          said.push(`Сам найти «${step.target}» пока не умею. Коснитесь того, что убрать, — я выделю, затем нажмите «Убрать»`);
          continue;
        }
        const res = maskStep(act, next);
        if (res.edits) next = res.edits;
        said.push(res.say);
      } else {
        const handler = LOCAL_ACTIONS[step.kind];
        const res = handler ? handler(step, { photo, edits: next }) : { say: "Пока не умею. Попробуйте: «ярче», «теплее», «убери пересвет»." };
        if (res.edits) next = res.edits;
        said.push(res.say);
      }
    }
    if (next !== saved) commit(next);
    setAnswer({ ok: next !== saved || r.steps.every((s) => s.kind === "keep"), say: said.join(". ") });
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
        <Preview
          key={photo.id}
          photo={photo}
          thumb={thumbs[photo.id]}
          edits={edits}
          selecting={aiOn && ai.status === "ready"}
          selection={aiOn && ai.status === "ready" && ai.shown !== false ? { mask, points: ai.points } : null}
          onTap={tap}
        />

        <SelectPanel
          ai={aiOn ? ai : AI_OFF}
          hasMask={hasMask}
          readOnly={readOnly}
          onStart={() => startSelect()}
          onCancel={cancelSelect}
          onMode={(add) => setAi((b) => ({ ...b, add }))}
          onUndoPoint={() => segment(ai.points.slice(0, -1))}
          onClear={() => segment([])}
          onAction={applyMask}
          onDone={() => setAi(AI_OFF)}
        />

        {(lowDpiIds?.has(photo.id) || saved.upscale === 2) && (
          <UpscaleCard photo={photo} edits={saved} up={up?.photoId === photo.id ? up : null} readOnly={readOnly} onRun={runUpscale} onCancel={() => stopUpscale()} onRemove={removeUpscale} />
        )}

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
          <p className="small pe-answer" data-ok={answer ? String(answer.ok) : undefined} role="status" aria-live="polite">
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

// Выделение касанием (D1): кнопка, прогресс с «Отмена», режим «Добавить / Убрать», действия
function SelectPanel({ ai, hasMask, readOnly, onStart, onCancel, onMode, onUndoPoint, onClear, onAction, onDone }) {
  if (ai.status === "off")
    return (
      <div className="pe-select">
        <button type="button" className="btn" onClick={onStart} disabled={readOnly}>
          Выделить касанием
        </button>
        <span className="muted small">Коснитесь предмета — и размойте фон, осветлите, затемните или уберите только его.</span>
      </div>
    );
  if (ai.status === "unsupported" || ai.status === "error")
    return (
      <div className="pe-select">
        <p className="small err-text" role="status">
          {ai.say}
        </p>
        {ai.status === "error" && (
          <button type="button" className="btn btn-small" onClick={onStart}>
            Попробовать ещё раз
          </button>
        )}
      </div>
    );
  if (ai.status === "loading") {
    const pct = Math.round((ai.p || 0) * 100);
    return (
      <div className="pe-select" aria-busy="true">
        <p className="small" role="status" aria-live="polite">
          {ai.stage === "load" ? `Загружаем выделение на устройство: ${pct}% (один раз, около 14 МБ)` : "Изучаем фото — 10–20 секунд, один раз для этого фото. Можно пока двигать ползунки."}
        </p>
        <progress className="pe-progress" max={100} value={ai.stage === "load" ? pct : undefined} aria-label="Подготовка выделения" />
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Отмена
        </button>
      </div>
    );
  }
  const pend = (act) => (ai.pending === act ? " btn-primary" : "");
  return (
    <div className="pe-select" data-ready="true">
      <p className="small" role="status" aria-live="polite">
        {ai.busy ? "Выделяем…" : !ai.points.length ? "Коснитесь предмета на фото." : hasMask ? "Выделено. Ещё касание — добавить или убрать часть." : "Ничего не выделилось — коснитесь ещё раз."}
      </p>
      <div className="row wrap pe-select-row" role="group" aria-label="Что делает касание">
        <button type="button" className="btn btn-small" aria-pressed={ai.add !== false} onClick={() => onMode(true)}>
          + Добавить
        </button>
        <button type="button" className="btn btn-small" aria-pressed={ai.add === false} onClick={() => onMode(false)} disabled={!ai.points.length}>
          − Убрать часть
        </button>
        <button type="button" className="btn btn-small" onClick={onUndoPoint} disabled={!ai.points.length}>
          Отменить точку
        </button>
        <button type="button" className="btn btn-small" onClick={onClear} disabled={!ai.points.length}>
          Сбросить
        </button>
      </div>
      <div className="row wrap pe-select-row" role="group" aria-label="Что сделать с выделенным">
        <button type="button" className={"btn btn-small" + pend("blurBg")} onClick={() => onAction("blurBg")} disabled={readOnly || !hasMask}>
          Размыть фон
        </button>
        <button type="button" className={"btn btn-small" + pend("lighten")} onClick={() => onAction("lighten")} disabled={readOnly || !hasMask}>
          Осветлить
        </button>
        <button type="button" className={"btn btn-small" + pend("darken")} onClick={() => onAction("darken")} disabled={readOnly || !hasMask}>
          Затемнить
        </button>
        <button type="button" className={"btn btn-small" + pend("erase")} onClick={() => onAction("erase")} disabled={readOnly || !hasMask}>
          Убрать
        </button>
        <button type="button" className="btn btn-small" onClick={onDone}>
          Готово
        </button>
      </div>
    </div>
  );
}

// «Резкость для печати» (D1): ×2 для фото, которому не хватает точек на своём месте
function UpscaleCard({ photo, edits, up, readOnly, onRun, onCancel, onRemove }) {
  const long = Math.max(photo.w || 0, photo.h || 0);
  if (edits.upscale === 2)
    return (
      <div className="pe-note small pe-upscale">
        <b>Резкость для печати ×2 включена</b> — в печать уйдёт увеличенное фото {photo.w * 2}×{photo.h * 2}.{" "}
        <button type="button" className="btn btn-small" onClick={onRemove} disabled={readOnly}>
          Выключить
        </button>
      </div>
    );
  if (long > 1500)
    return <p className="pe-note small">Этому фото не хватает точек для печати. Возьмите оригинал (не из мессенджера) или замените снимок.</p>;
  if (up?.status === "run")
    return (
      <div className="pe-note small pe-upscale" aria-busy="true">
        <span role="status" aria-live="polite">
          Делаем резче для печати: {Math.round((up.p || 0) * 100)}%
        </span>
        <progress className="pe-progress" max={100} value={Math.round((up.p || 0) * 100)} aria-label="Резкость для печати" />
        <button type="button" className="btn btn-small" onClick={onCancel}>
          Отмена
        </button>
      </div>
    );
  return (
    <div className="pe-note small pe-upscale">
      {up?.status === "error" ? (
        <span className="err-text" role="status">
          {up.say}
        </span>
      ) : (
        <span>Этому фото не хватает точек для печати ({photo.w}×{photo.h}). Нейросеть на телефоне увеличит его вдвое и сделает края чётче.</span>
      )}{" "}
      <button type="button" className="btn btn-small" onClick={onRun} disabled={readOnly}>
        Резкость для печати ×2
      </button>
    </div>
  );
}

// Превью: «после» — canvas с правками, «до» — второй canvas поверх (ползунок или удержание).
// D1: ластик — до света и цвета (воркер, кэш), выделение — третий canvas с подсветкой маски и точками.
function Preview({ photo, thumb, edits, selecting, selection, onTap }) {
  const photoId = photo.id;
  const afterRef = useRef(null);
  const beforeRef = useRef(null);
  const maskRef = useRef(null);
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [split, setSplit] = useState(0);
  const [hold, setHold] = useState(false);
  const [erased, setErased] = useState(null); // { key, img }
  const [eraseFail, setEraseFail] = useState(null); // ключ набора «Убрать», который не получился
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

  // Ластик: результат для текущего набора «Убрать» (из кэша или воркер)
  const eraseOps = splitOps(edits?.ops).erase;
  const eKey = eraseKey(photoId, eraseOps);
  const eJson = JSON.stringify(eraseOps);
  useEffect(() => {
    if (!src) return;
    const ops = JSON.parse(eJson);
    if (!ops.length) return;
    let alive = true;
    ensureErased(photoId, src, ops)
      .then((img) => alive && setErased({ key: eKey, img }))
      .catch((e) => {
        if (!alive || isCancelled(e)) return;
        console.error(e);
        setEraseFail(eKey);
      });
    return () => {
      alive = false;
    };
  }, [src, photoId, eKey, eJson]);
  const base = !eraseOps.length ? src : erased?.key === eKey ? erased.img : null;

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
      const ed = JSON.parse(key);
      // Пока ластик считается — показываем без него (остальные правки уже видны)
      applyEdits((base || src).data, out.data, ed);
      const rest = splitOps(ed?.ops).rest;
      if (rest.length) applyOps(out.data, src.width, src.height, rest);
      c.getContext("2d").putImageData(out, 0, 0);
      c.dataset.rendered = base || !eraseOps.length ? key : "";
    }, 0);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, key, base]);

  // Подсветка выделения: маска полупрозрачным цветом, точки «+» и «−»
  const selKey = selection ? (selection.mask ? selection.mask.w + "x" + selection.mask.h + ":" + maskArea(selection.mask.bits) : "") + JSON.stringify(selection.points) : "";
  useEffect(() => {
    const c = maskRef.current;
    if (!c || !src) return;
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    if (!selection) return;
    const m = selection.mask;
    if (m) {
      const img = new ImageData(m.w, m.h);
      for (let i = 0; i < m.bits.length; i++) {
        if (!m.bits[i]) continue;
        img.data[i * 4] = 40;
        img.data[i * 4 + 1] = 140;
        img.data[i * 4 + 2] = 255;
        img.data[i * 4 + 3] = 120;
      }
      const t = document.createElement("canvas");
      t.width = m.w;
      t.height = m.h;
      t.getContext("2d").putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(t, 0, 0, c.width, c.height);
    }
    const sx = m ? c.width / m.w : 1;
    const sy = m ? c.height / m.h : 1;
    const r = Math.max(6, Math.round(Math.max(c.width, c.height) / 90));
    for (const p of selection.points || []) {
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, r, 0, Math.PI * 2);
      ctx.fillStyle = p.add ? "#1f9d55" : "#bd3434";
      ctx.fill();
      ctx.lineWidth = Math.max(2, r / 3);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, selKey]);

  const shown = selecting ? 0 : hold ? 100 : split;
  const holdOn = () => !selecting && setHold(true);
  const holdOff = () => setHold(false);
  function onStageClick(e) {
    if (!selecting || !afterRef.current) return;
    const r = afterRef.current.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width;
    const v = (e.clientY - r.top) / r.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    onTap(u, v);
  }
  if (failed) return <p className="err-text small">Не получилось открыть фото на этом устройстве. Попробуйте перезагрузить страницу.</p>;
  const erasing = !!src && eraseOps.length > 0 && !base;
  return (
    <div className="pe-preview">
      <div
        className={"pe-stage" + (selecting ? " selecting" : "")}
        onPointerDown={holdOn}
        onPointerUp={holdOff}
        onPointerLeave={holdOff}
        onPointerCancel={holdOff}
        onClick={onStageClick}
        data-compare={shown}
        data-selecting={selecting ? "true" : undefined}
      >
        {!src && <div className="pe-loading muted small">Открываем фото…</div>}
        <canvas ref={afterRef} className="pe-after" aria-label={"Фото после правок: " + photo.name} role="img" />
        <canvas ref={beforeRef} className="pe-before" style={{ clipPath: `inset(0 ${100 - shown}% 0 0)` }} aria-hidden="true" />
        <canvas ref={maskRef} className="pe-mask" aria-hidden="true" />
        {shown > 0 && shown < 100 && <span className="pe-divider" style={{ left: shown + "%" }} aria-hidden="true" />}
        {shown > 0 && <span className="pe-tag left">До</span>}
        {shown < 100 && !selecting && <span className="pe-tag right">После</span>}
        {erasing && (
          <span className="pe-busy small" role="status" aria-live="polite">
            {eraseFail === eKey ? "Не получилось убрать — «Отменить» вернёт как было" : "Убираем выделенное…"}
          </span>
        )}
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
          disabled={selecting}
        >
          Удерживайте — оригинал
        </button>
        <label className="pe-compare-range">
          <span className="small">До / после</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="До / после: сколько показать оригинала слева" disabled={selecting} />
        </label>
      </div>
    </div>
  );
}
