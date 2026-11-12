"use client";
// Шаг «Правки»: ИИ-редактор фото (S03a–b). Загружается только при открытии шага (next/dynamic в app/editor/page.js).
//
// Как устроено:
// - правки неразрушающие: в проекте хранится photo.edits (lib/photo/adjust.js), оригинал не меняется;
// - превью: оригинал из IndexedDB уменьшается до ≤ 1280 точек, пиксели правятся таблицами (canvas 2D), «до» — второй слой;
// - команды разбирает словарь на устройстве (lib/photo/commands.js); «убери солнце» — без нейросети (lib/photo/local.js);
// - D1: выделение касанием (SlimSAM в воркере, lib/photo/ai.js) → «Размыть фон», «Осветлить», «Затемнить», «Убрать»
//   (ластик MI-GAN в своём воркере). Маска хранится в правках фото один раз (lib/photo/maskStore.js), превью и печать
//   считают её одинаково (lib/photo/mask.js); ластик — до света и цвета (результат кэшируется), остальное — после;
//   правки фото всегда помещаются в предел сервера (PHOTO_EDITS_MAX) — проверяем до сохранения;
// - D1: «Резкость для печати» ×2 (UpscalerJS, lib/photo/upscale.js) для фото, которым не хватает точек;
// - N3: всё на устройстве, облака нет: стили-пресеты (edits.look), поиск предмета словом («убери машину», «размой собаку»):
//   YOLOX-Nano в воркере выделения → рамка → SlimSAM по рамке → маска → та же правка, что после касания;
// - история шагов — в памяти редактора (кнопка «Отменить»), каждый шаг сразу сохраняется в черновике.
import { useEffect, useRef, useState } from "react";
import { getDraftState, getPhotoBlob, kvSet, mapDraftPhotos, setPhotoEdits } from "../../lib/draft";
import { ADJUST_KEYS, ADJUST_LABELS, addManual, applyEdits, compactEdits, emptyEdits, hasAuto, hasManual, normEdits, setLook, setManual } from "../../lib/photo/adjust";
import { autoParams } from "../../lib/photo/analyze";
import { SUGGESTIONS, parseCommand } from "../../lib/photo/commands";
import { photoBadges } from "../../lib/photo/badges";
import { applyOps, findSun } from "../../lib/photo/local";
import { MAX_MASK_OPS, addMaskOp, editsFit, eraseKey, hydrateOps, maskArea, splitOps } from "../../lib/photo/mask";
import { aiSupport, aiWhy, detectObjects, embedImage, embeddedFor, eraseImage, isCancelled, meaningOf, segmentBox, segmentPoints, stopAi, stopEraser, stopMeaning } from "../../lib/photo/ai";
import { OBJECT_EXAMPLES, boxMask, clipMaskToBox, pickObjects, unionMasks } from "../../lib/photo/objects";
import { MIGAN_FILE, ORT_WASM, SAM_FILES, mb } from "../../lib/photo/modelFiles";
import { UPSCALE_MAX_SIDE, stopUpscale, upscaleBlob, upscaleKey } from "../../lib/photo/upscale";
import { setAutoEnhance, useAutoEnhance } from "../../lib/photo/settings";
import AiPrefetch, { useAiOffline } from "./AiPrefetch";
import { notify } from "../../lib/store";
import { track } from "@/lib/analytics";

const PREVIEW_SIDE = 1280;
const MIN_PREVIEW_SIDE = 640; // очень маленькие фото (48×32) показываем крупно — по ним можно попасть пальцем
const SAM_MB = mb([...SAM_FILES, ORT_WASM]);
const ERASER_MB = mb([MIGAN_FILE, ORT_WASM]);

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
  // Творческих правок (FLUX) нет — решение 12.11: их пришлось бы встроить в печатную версию
  creative: () => ({ say: "Дорисовывать небо, снег и другое мы не умеем — фото печатается таким, каким его сняли. Работают свет и цвет: «ярче», «теплее», «убери пересвет», и правки по выделению касанием." }),
};

// Кэш уменьшенных оригиналов (ImageData) — последние 4 фото
const cache = new Map();
async function loadSource(id, thumbUrl) {
  if (cache.has(id)) return cache.get(id);
  let blob = await getPhotoBlob(id).catch(() => null);
  if (!blob && thumbUrl) blob = await fetch(thumbUrl).then((r) => r.blob());
  if (!blob) throw new Error("Нет файла фото на устройстве");
  const bmp = await createImageBitmap(blob);
  const long = Math.max(bmp.width, bmp.height);
  const k = long < MIN_PREVIEW_SIDE ? MIN_PREVIEW_SIDE / long : Math.min(1, PREVIEW_SIDE / long);
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

// N3: дождаться, пока выделение (SlimSAM) будет готово для фото pid. null — не получилось, отменили или фото сменили
async function waitReady(aiRef, cur, pid, ms = 180_000) {
  for (let waited = 0; waited < ms; waited += 200) {
    if (cur.current !== pid) return null;
    const a = aiRef.current;
    if (a.photoId === pid && a.status === "ready") return a;
    if (a.status === "error" || a.status === "unsupported" || a.status === "off" || a.photoId !== pid) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
  return null;
}

// N3: правка по маске найденного предмета — поверх свежих правок фото из черновика (поиск долгий, замыкание
// рендера могло устареть). Те же пределы, что у правки после касания. → { edits, before } или { say }
function applyFoundMask(pid, act, m) {
  const proj = getDraftState().draft;
  const ph = proj?.photos.find((p) => p.id === pid);
  if (!ph) return { say: "Этого фото уже нет в проекте." };
  const base = normEdits(ph.edits);
  if ((base.ops || []).filter((o) => o.kind === "mask").length >= MAX_MASK_OPS)
    return { say: `Для одного фото — не больше ${MAX_MASK_OPS} правок по выделению. «Отменить» или «Вернуть оригинал» освободят место.` };
  const { edits: packed } = addMaskOp(base, act, m.bits, m.w, m.h);
  const next = { ...packed, by: "command" };
  if (!editsFit(compactEdits(next))) return { say: "На этом фото уже много правок по выделению — новая не поместится в заказ. «Отменить» уберёт последнюю, «Вернуть оригинал» — все." };
  let n = 0;
  for (const p of proj.photos) n += JSON.stringify(compactEdits(p.id === pid ? next : p.edits) || "").length;
  if (n > 45_000) return { say: "В проекте уже очень много правок по выделению. Отмените часть — и можно продолжить." };
  return { edits: next, before: base };
}

// N3: команда, подобранная по смыслу, — свет, цвет, стиль или автоулучшение — поверх свежих правок фото из черновика
// (модель думала, замыкание рендера могло устареть). Остальное (по выделению) — null: тогда предлагаем кнопку.
function applyCommandFresh(pid, label) {
  const ph = getDraftState().draft?.photos.find((p) => p.id === pid);
  const r = parseCommand(label);
  if (!ph || !r.ok || !r.steps.every((x) => x.kind === "adjust" || x.kind === "look" || x.kind === "auto")) return null;
  const before = normEdits(ph.edits);
  let next = before;
  const said = [];
  for (const step of r.steps) {
    if (step.kind === "adjust") {
      next = addManual(next, step.deltas, "command");
      if (step.look) next = setLook(next, step.look);
    } else if (step.kind === "look") {
      next = setLook(next, null);
      if ((next.manual.saturation || 0) < 0) next = setManual(next, "saturation", 0, "command");
    } else {
      const m = ph.quality?.metrics;
      if (!m) return null;
      next = { ...next, auto: autoParams(m, { force: true }), autoOff: false };
    }
    said.push(step.say);
  }
  return { before, next, say: said.join(". "), last: r.steps.find((x) => x.kind === "adjust") || null };
}

const loadedSize = (id) => {
  const img = cache.get(id);
  return img ? { w: img.width, h: img.height } : null;
};

// Ластик (D1): результат «Убрать» для превью считается в воркере ластика один раз и кэшируется по набору правок.
// Ход (загрузка модели в первый раз с процентом, затем расчёт) — общий: его видят превью и строка ответа.
const erasedCache = new Map();
const erasing = new Map(); // ключ → Promise
const eraseState = new Map(); // ключ → { stage: "load" | "erase", p }
const eraseListeners = new Set();
const emitErase = () => eraseListeners.forEach((f) => f());
function ensureErased(photoId, src, eraseOps) {
  if (!eraseOps.length) return Promise.resolve(src);
  const key = eraseKey(photoId, eraseOps);
  if (erasedCache.has(key)) return Promise.resolve(erasedCache.get(key));
  if (!erasing.has(key)) {
    eraseState.set(key, { stage: "load", p: 0 });
    const p = eraseImage(src, eraseOps, (m) => {
      eraseState.set(key, { stage: m.stage, p: m.p || 0 });
      emitErase();
    }).then(
      (img) => {
        erasedCache.set(key, img);
        if (erasedCache.size > 4) erasedCache.delete(erasedCache.keys().next().value);
        erasing.delete(key);
        eraseState.delete(key);
        emitErase();
        return img;
      },
      (e) => {
        erasing.delete(key);
        eraseState.delete(key);
        emitErase();
        throw e;
      },
    );
    erasing.set(key, p);
    emitErase();
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

const MASK_SAY = { blurBg: "Размыли фон — главное осталось чётким", blur: "Размыли выделенное", lighten: "Осветлили выделенное", darken: "Затемнили выделенное", erase: "Убираем выделенное…" };
const ERASED_SAY = "Убрали выделенное. «Отменить» вернёт как было.";
const MASK_VERB = { blurBg: "Размыть фон", blur: "Размыть выделенное", lighten: "Осветлить выделенное", darken: "Затемнить выделенное", erase: "Убрать" };
// Что сделали с найденным словом предметом (N3)
const FOUND_SAY = { blurBg: "размыл фон вокруг", blur: "размыл", lighten: "осветлил", darken: "затемнил" };
const AI_OFF = { status: "off" };

export default function PhotoEditor({ draft, thumbs, readOnly, lowDpiIds, dupIds, extra, initialPhotoId }) {
  const usable = draft.photos.filter((p) => p.supported);
  const [sel, setSel] = useState(initialPhotoId || usable[0]?.id || null);
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
  const [pendingErase, setPendingErase] = useState(null); // { photoId, opId } — «Убрать», нажатое в этом сеансе
  const aiOk = aiSupport().ok; // выделение касанием на этом устройстве возможно (иначе — честные ответы)
  const offline = useAiOffline(ai.status + ":" + (answer?.say || "")); // модели ИИ уже на устройстве — работает без интернета
  const fresh = useRef(null); // id открытого фото — для долгих операций (поиск предмета словом)

  // Память воркеров ИИ освобождаем, когда редактор закрыт
  useEffect(
    () => () => {
      stopAi();
      stopEraser();
      stopUpscale();
      stopMeaning();
    },
    [],
  );

  // Какое фото открыто сейчас (N3: поиск предмета словом долгий — пока искали, могли выбрать другое фото)
  useEffect(() => {
    fresh.current = photo?.id || null;
  });

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
    // Другое фото — результат кодировщика больше не нужен: освобождаем память воркера выделения
    if (id !== photo.id) stopAi();
    setSel(id);
    setLive(null);
    setAnswer(null);
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
    // То же фото после «Готово»: результат кодировщика ещё в воркере — выделение готово сразу
    const done = embeddedFor(key);
    if (done) return setAi({ status: "ready", photoId: pid, key, w: done.w, h: done.h, points: [], mask: null, add: true, pending, shown: true });
    const eraseOps = splitOps(hydrateOps(saved)).erase;
    setAi({ status: "loading", photoId: pid, key, stage: "load", p: 0, points: [], mask: null, add: true, pending, shown: true });
    try {
      const still = () => aiRef.current.status === "loading" && aiRef.current.key === key && aiRef.current.photoId === pid;
      const src = await loadSource(pid, thumbs[pid]);
      // Пока считается ластик — ждём его (выделяем уже без убранного предмета); «Отмена» в это время — просто выход
      const base = await ensureErased(pid, src, eraseOps);
      if (!still()) return;
      const order = { load: 0, start: 1, embed: 2 };
      const r = await embedImage(key, toSide(base, 1024), (m) =>
        // Ход только вперёд: загрузка (процент по байтам) → запуск → «Изучаем фото»
        setAi((b) => (b.key === key && b.status === "loading" && order[m.stage] >= order[b.stage || "load"] ? { ...b, stage: m.stage, p: m.stage === b.stage ? Math.max(b.p || 0, m.p || 0) : m.p || 0 } : b)),
      );
      setAi((b) => (b.key === key && b.photoId === pid ? { ...b, status: "ready", w: r.w, h: r.h } : b));
    } catch (e) {
      // Остановили (выделение или ластик, которого ждали) — не висим в «Загружаем…»
      if (isCancelled(e)) return setAi((b) => (b.key === key && b.status === "loading" ? AI_OFF : b));
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
    if (!points.length) return setAi({ ...a, points, mask: null, busy: false, add: true });
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
  function maskStep(act, base, m = mask) {
    const sup = aiSupport();
    const has = !!(m && maskArea(m.bits));
    if (!sup.ok && !has) return { say: `«${MASK_VERB[act]}» на этом устройстве не получится: нужно выделение касанием, а ${aiWhy(sup)}. Работают свет и цвет: «ярче», «теплее», «убери пересвет».` };
    if (!has) {
      startSelect(act);
      const what = act === "blurBg" ? "главного на фото — того, что должно остаться чётким" : act === "erase" ? "того, что убрать" : "того, что изменить";
      const btn = { blurBg: "Размыть фон", blur: "Размыть", lighten: "Осветлить", darken: "Затемнить", erase: "Убрать" }[act];
      return { say: `Коснитесь ${what}, затем нажмите «${btn}».` };
    }
    const ops = base.ops || [];
    if (ops.filter((o) => o.kind === "mask").length >= MAX_MASK_OPS)
      return { say: `Для одного фото — не больше ${MAX_MASK_OPS} правок по выделению. «Отменить» или «Вернуть оригинал» освободят место.` };
    // Маска сжимается и хранится один раз (одинаковое выделение не дублируется)
    const { edits: packed, op } = addMaskOp(base, act, m.bits, m.w, m.h);
    const next = { ...packed, by: "command" };
    // Правки фото должны поместиться на сервер печатной версии (тот же счёт, что у сервера) — проверяем заранее
    if (!editsFit(compactEdits(next)))
      return { say: "На этом фото уже много правок по выделению — новая не поместится в заказ. «Отменить» уберёт последнюю, «Вернуть оригинал» — все." };
    if (editsSize(next) > 45_000) return { say: "В проекте уже очень много правок по выделению. Отмените часть — и можно продолжить." };
    track("ai_edit", { props: { kind: "local" } });
    if (act === "erase") {
      // Предмет убран — выделение по старому фото больше не годится: освобождаем память воркера выделения,
      // ластик считается в своём воркере (с процентом первой загрузки и «Отменой»)
      stopAi();
      setAi(AI_OFF);
      setPendingErase({ photoId: photo.id, opId: op.id });
    } else setAi((b) => ({ ...b, pending: null, shown: false }));
    return { edits: next, say: MASK_SAY[act] };
  }

  // «Отмена» ластика: остановить расчёт и убрать эту правку «Убрать» (как будто её не нажимали)
  function cancelErase() {
    const pe = pendingErase;
    stopEraser();
    setPendingErase(null);
    if (!pe) return;
    const ph = draft.photos.find((x) => x.id === pe.photoId);
    if (!ph) return;
    const ed = normEdits(ph.edits);
    setPhotoEdits(pe.photoId, { ...ed, ops: ed.ops.filter((o) => o.id !== pe.opId) });
    setAnswer({ ok: true, say: "Ластик остановили — фото как было." });
  }

  // Ластик досчитал или не смог — строка ответа больше не «Убираем…»
  function eraseFinished(ok) {
    setPendingErase(null);
    setAnswer((a) => (a?.say === MASK_SAY.erase ? { ok, say: ok ? ERASED_SAY : "Не получилось убрать. «Отменить» вернёт как было." } : a));
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

  // N3: поиск предмета словом — целиком на устройстве. YOLOX-Nano (воркер выделения) находит рамки, SlimSAM выделяет
  // предмет по рамке (без SlimSAM — овал по рамке), дальше та же правка, что после касания. act: blur | lighten | darken |
  // blurBg — сразу; erase — выделяем и ждём «Убрать» (ластик тяжёлый, выделение лучше проверить); null — только выделить.
  async function findObject(step, act) {
    const pid = photo.id;
    const what = step.objSay || step.target;
    const touch = act === "erase" ? "Коснитесь того, что убрать, — я выделю, затем нажмите «Убрать»." : "Коснитесь нужного на фото — я выделю.";
    const alive = () => fresh.current === pid;
    const say = (a) => alive() && setAnswer(a);
    const sam = aiSupport().ok;
    let dets;
    try {
      const src = await ensureErased(pid, await loadSource(pid, thumbs[pid]), splitOps(hydrateOps(saved)).erase);
      if (!alive()) return;
      const found = detectObjects(toSide(src, 416), (m) => m.stage === "load" && say({ ok: true, say: `Ищу ${what} на фото: загружаем поиск предметов на устройство, ${Math.round((m.p || 0) * 100)}%` }));
      if (sam) startSelect(act); // выделение готовится сразу после поиска (в том же воркере, по очереди)
      dets = await found;
    } catch (e) {
      if (isCancelled(e)) return;
      console.error(e, e?.workerStack || "");
      return say({ ok: false, say: `Не получилось поискать ${what}. ${touch}` });
    }
    if (!alive()) return;
    const picked = pickObjects(dets, step);
    if (!picked.length) return say({ ok: false, say: `Не нашёл ${what} на этом фото. ${sam ? touch : "Работают свет и цвет: «ярче», «теплее»."}` });
    say({ ok: true, say: `Нашёл ${what}${picked.length > 1 ? ` (${picked.length})` : ""}, выделяю…` });
    let m = null;
    if (sam) {
      const a = await waitReady(aiRef, fresh, pid);
      if (!a) return aiRef.current.status === "off" ? undefined : say({ ok: false, say: `Нашёл ${what}, но выделить не получилось. ${touch}` });
      let bits = null;
      let w = 0;
      let h = 0;
      try {
        for (const b of picked) {
          const r = await segmentBox(a.key, b);
          w = r.w;
          h = r.h;
          bits = unionMasks(bits, clipMaskToBox(r.mask, r.w, r.h, b));
        }
      } catch (e) {
        if (isCancelled(e)) return;
        console.error(e, e?.workerStack || "");
        bits = null;
      }
      if (!alive() || aiRef.current.key !== a.key) return;
      if (!bits || maskArea(bits) < w * h * 0.0005) return say({ ok: false, say: `Не получилось выделить ${what}. ${touch}` });
      m = { bits, w, h };
      setAi((st) => ({ ...st, points: [], mask: m, busy: false, pending: act, shown: true }));
    } else {
      // Мало памяти для SlimSAM: овал по рамке (в размере хранимой маски)
      const size = loadedSize(pid) || { w: 4, h: 3 };
      const w = 320;
      const h = Math.max(1, Math.round((320 * size.h) / size.w));
      let bits = null;
      for (const b of picked) bits = unionMasks(bits, boxMask(b, w, h));
      m = { bits, w, h };
    }
    if (!act || act === "erase") {
      if (!sam) return say({ ok: false, say: `Нашёл ${what}, но ${act === "erase" ? "убрать" : "выделить"} на этом устройстве не получится: для этого ${aiWhy(aiSupport())}.` });
      return say({
        ok: true,
        say:
          act === "erase"
            ? `Нашёл и выделил ${what}. Проверьте выделение и нажмите «Убрать» — или коснитесь, чтобы поправить.`
            : `Нашёл и выделил ${what}. Дальше: «Размыть», «Размыть фон», «Осветлить», «Затемнить» или «Убрать».`,
      });
    }
    // Правка сразу — по свежим правкам фото из черновика (замыкание этого рендера уже могло устареть)
    const r = applyFoundMask(pid, act, m);
    if (!r.edits) return say({ ok: false, say: r.say });
    const before = r.before;
    setHistory((hst) => ({ ...hst, [pid]: [...(hst[pid] || []), before].slice(-30) }));
    setPhotoEdits(pid, r.edits);
    track("ai_edit", { props: { kind: "local" } });
    setAi((b) => ({ ...b, pending: null, shown: false }));
    say({ ok: true, say: `Нашёл ${what} и ${FOUND_SAY[act]}. «Отменить» вернёт как было.` });
  }

  // N3 (SHOULD): словарь не понял — маленькая модель на устройстве ищет ближайшую команду по смыслу.
  // Уверена — выполняем («По смыслу — «Тёплый вечер»…»), нет — до 3 кнопок с похожими командами, совсем мимо — подсказка
  async function askMeaning(text, fallback) {
    const pid = photo.id;
    setAnswer({ ok: false, say: `Не знаю команды «${text}» — подбираю похожую по смыслу…`, thinking: true });
    let res = null;
    try {
      res = await meaningOf(text, (m) => fresh.current === pid && setAnswer({ ok: false, say: `Не знаю команды «${text}» — загружаем подсказчик на устройство: ${Math.round((m.p || 0) * 100)}%`, thinking: true }));
    } catch (e) {
      if (!isCancelled(e)) console.error(e);
    }
    if (fresh.current !== pid) return;
    if (res?.pick) {
      const others = res.options.filter((o) => o.id !== res.pick.id).slice(0, 2);
      const done = applyCommandFresh(pid, res.pick.label);
      if (!done) return setAnswer({ ok: true, say: `Понял по смыслу как «${res.pick.label}». Нажмите, чтобы применить:`, options: [res.pick, ...others], meant: true });
      setHistory((h) => ({ ...h, [pid]: [...(h[pid] || []), done.before].slice(-30) }));
      setPhotoEdits(pid, done.next);
      if (done.last) setLast(done.last);
      track("ai_edit", { props: { kind: "command" } });
      return setAnswer({ ok: true, say: `По смыслу — «${res.pick.label}»: ${done.say}. «Отменить» вернёт как было.${others.length ? " Или:" : ""}`, options: others });
    }
    // Не уверена (в том числе на бессмыслице) — ничего не меняем: подсказка словаря и 3 похожие команды кнопками
    if (res?.options?.length) return setAnswer({ ok: false, say: `${fallback} Или похожее по смыслу:`, options: res.options });
    setAnswer({ ok: false, say: fallback });
  }

  function run(text) {
    if (readOnly) return;
    const r = parseCommand(text, { last });
    if (!r.ok) {
      setAnswer({ ok: false, say: r.say });
      if (String(text || "").trim()) askMeaning(String(text).trim(), r.say);
      return;
    }
    track("ai_edit", { props: { kind: "command" } });
    let next = saved;
    const said = [];
    for (const step of r.steps) {
      if (step.kind === "adjust") {
        next = addManual(next, step.deltas, "command");
        if (step.look) next = setLook(next, step.look); // стиль-пресет: ч/б, сепия, винтаж…
        setLast(step);
        said.push(step.say);
      } else if (step.kind === "look") {
        // «Верни цвет», «убери фильтр»: стиль долой, а «бесцветность» ч/б — тоже
        next = setLook(next, null);
        if ((next.manual.saturation || 0) < 0) next = setManual(next, "saturation", 0, "command");
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
      } else if (step.classes?.length) {
        // N3: предмет назван словом — ищем его на устройстве (даже если что-то уже выделено касанием)
        const act = step.kind === "remove" ? "erase" : step.kind === "maskBlur" ? "blur" : step.kind === "blurBackground" ? "blurBg" : step.kind === "maskTone" ? (step.dir > 0 ? "lighten" : "darken") : null;
        findObject(step, act);
        said.push(`Ищу ${step.objSay || step.target} на фото…`);
      } else if (step.kind === "blurBackground" || step.kind === "maskTone" || step.kind === "maskBlur" || (step.kind === "remove" && step.target !== "sun" && step.target !== "glare")) {
        // Правки по выделению касанием. «Убери X», где X — не из словаря предметов: выделенное или просьба коснуться
        const act = step.kind === "blurBackground" ? "blurBg" : step.kind === "maskBlur" ? "blur" : step.kind === "maskTone" ? (step.dir > 0 ? "lighten" : "darken") : "erase";
        const sup = aiSupport();
        if (act === "erase" && !sup.ok && step.target !== "selection") {
          said.push(`Убрать «${step.target}» на этом устройстве не получится: нужно выделение касанием, а ${aiWhy(sup)}. Работают свет и цвет и «убери солнце»`);
          continue;
        }
        if (act === "erase" && !hasMask && step.target !== "selection") {
          startSelect("erase");
          said.push(`Не знаю, как выглядит «${step.target}», — коснитесь этого на фото, я выделю, затем нажмите «Убрать». Сам нахожу: ${OBJECT_EXAMPLES}`);
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
    setAnswer({ ok: next !== saved || r.steps.every((s) => s.kind === "keep" || s.classes?.length), say: said.join(". ") });
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
      {/* N3: ИИ только на устройстве. Честно: в хранилище фото уходят только при сохранении в аккаунт и заказе — для печати */}
      <div className="pe-note small" role="note" data-local-ai style={{ marginBottom: 8 }}>
        <b>ИИ работает на вашем телефоне — для правок фото никуда не отправляются.</b>{" "}
        {offline && (
          <span className="ok-text" data-offline-ready>
            Работает без интернета.
          </span>
        )}
        <span className="muted" style={{ display: "block" }}>
          Команды, стили, поиск предметов, выделение и ластик считаются на этом устройстве. Фото попадают в наше хранилище, только когда вы сохраняете проект в аккаунте или оформляете заказ — для печати.
        </span>
      </div>
      <p className="muted">Скажите, что изменить, или подвигайте ползунки — оригинал не меняется, всё можно вернуть.</p>
      <div className="pe-strip" role="list" aria-label="Фото проекта">
        {usable.map((p, i) => {
          const b = photoBadges(p, { lowDpi: lowDpiIds?.has(p.id), duplicate: dupIds?.has(p.id) });
          return (
            <div role="listitem" key={p.id}>
              <button className={"photo-cell" + (p.id === photo.id ? " selected" : "")} onClick={() => choose(p.id)} aria-pressed={p.id === photo.id} aria-label={`Фото ${i + 1}: ${p.name}${b.length ? " — " + b.map((x) => x.label).join(", ") : ""}`} data-edit-photo={p.name}>
                {/* eslint-disable-next-line @next/next/no-img-element -- фото клиента с устройства (blob:/data:): next/image их не оптимизирует, оптимизатор Vercel для фото клиентов не используем */}
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
          selection={aiOn && ai.status === "ready" && ai.shown !== false ? { mask, points: ai.points, w: ai.w, h: ai.h } : null}
          onTap={tap}
          cancelableErase={pendingErase?.photoId === photo.id ? pendingErase.opId : null}
          onCancelErase={cancelErase}
          onEraseDone={eraseFinished}
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
          // «Готово»: результат кодировщика остаётся в воркере — повторное «Выделить касанием» на этом фото сразу.
          // Память освобождается при смене фото и при закрытии редактора
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
            <input id="pe-cmd" className="input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="Например: тёплый вечер, ч/б, убери машину" disabled={readOnly} autoComplete="off" enterKeyHint="done" />
            <button type="submit" className="btn btn-primary" disabled={readOnly}>
              Сделать
            </button>
          </div>
          <div className="pe-chips" aria-label="Подсказки">
            {/* «Размыть фон» без выделения касанием на этом устройстве — тупик (S12): не показываем */}
            {SUGGESTIONS.filter((s) => aiOk || s !== "Размыть фон").map((s) => (
              <button type="button" key={s} className="btn btn-small" onClick={() => run(s)} disabled={readOnly}>
                {s}
              </button>
            ))}
          </div>
          <p className="small pe-answer" data-ok={answer ? String(answer.ok) : undefined} role="status" aria-live="polite" aria-busy={answer?.thinking ? "true" : undefined}>
            {answer?.say || ""}
          </p>
          {/* N3: похожие команды по смыслу (модель на устройстве) — одно нажатие выполняет команду словаря */}
          {answer?.options?.length > 0 && (
            <div className="pe-chips" aria-label="Похожие команды" data-meaning>
              {answer.options.map((o, i) => (
                <button type="button" key={o.id} className={"btn btn-small" + (answer.meant && i === 0 ? " btn-primary" : "")} onClick={() => run(o.label)} disabled={readOnly}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
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
        {/* ED (п. 4): скачать модели выделения и ластика заранее (~71 МБ) */}
        <AiPrefetch compact />
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
          {ai.stage === "load"
            ? `Загружаем выделение на устройство: ${pct}% (один раз, около ${SAM_MB} МБ)`
            : ai.stage === "start"
              ? "Запускаем нейросеть на устройстве…"
              : "Изучаем фото — 10–20 секунд, один раз для этого фото. Можно пока двигать ползунки."}
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
        <button type="button" className="btn btn-small" aria-pressed={ai.add !== false || !ai.points.length} onClick={() => onMode(true)}>
          + Добавить
        </button>
        <button type="button" className="btn btn-small" aria-pressed={ai.add === false && ai.points.length > 0} onClick={() => onMode(false)} disabled={!ai.points.length}>
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
        <button type="button" className={"btn btn-small" + pend("blur")} onClick={() => onAction("blur")} disabled={readOnly || !hasMask}>
          Размыть
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
        <span>Этому фото не хватает точек для печати ({photo.w}×{photo.h}). Нейросеть на этом устройстве увеличит его вдвое и сделает края чётче.</span>
      )}{" "}
      <button type="button" className="btn btn-small" onClick={onRun} disabled={readOnly}>
        Резкость для печати ×2
      </button>
    </div>
  );
}

// Превью: «после» — canvas с правками, «до» — второй canvas поверх (ползунок или удержание).
// D1: ластик — до света и цвета (воркер, кэш), выделение — третий canvas с подсветкой маски и точками.
function Preview({ photo, thumb, edits, selecting, selection, onTap, cancelableErase, onCancelErase, onEraseDone }) {
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
  const [retry, setRetry] = useState(0); // ластик остановили не кнопкой «Отмена» — считаем заново
  const [, setTick] = useState(0); // ход ластика (общий для превью и строки ответа)
  const timer = useRef(null);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    eraseListeners.add(f);
    return () => eraseListeners.delete(f);
  }, []);

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

  // Ластик: результат для текущего набора «Убрать» (из кэша или воркер ластика). Маски — из edits.masks
  const eraseOps = splitOps(hydrateOps(edits)).erase;
  const eKey = eraseKey(photoId, eraseOps);
  const eJson = JSON.stringify(eraseOps);
  useEffect(() => {
    if (!src) return;
    const ops = JSON.parse(eJson);
    if (!ops.length) return;
    let alive = true;
    ensureErased(photoId, src, ops)
      .then((img) => {
        if (!alive) return;
        setErased({ key: eKey, img });
        onEraseDone?.(true);
      })
      .catch((e) => {
        if (!alive) return;
        // Остановили (не нашей «Отменой» — тогда правки уже нет): правка осталась — считаем заново, а не висим
        if (isCancelled(e)) return setTimeout(() => alive && setRetry((r) => r + 1), 300);
        console.error(e);
        setEraseFail(eKey);
        onEraseDone?.(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, photoId, eKey, eJson, retry]);
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
      const rest = splitOps(hydrateOps(ed)).rest;
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
    // Точки — в точках картинки, по которой выделяем (selection.w×h), а не маски: первая точка сразу на месте
    const sx = c.width / (selection.w || m?.w || c.width);
    const sy = c.height / (selection.h || m?.h || c.height);
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
  const prog = eraseState.get(eKey);
  const ePct = Math.round((prog?.p || 0) * 100);
  const eLoading = prog?.stage === "load";
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
          <span className="pe-busy small" aria-hidden="true">
            {eraseFail === eKey ? "Не получилось убрать — «Отменить» вернёт как было" : eLoading ? `Загружаем ластик: ${ePct}%` : "Убираем выделенное…"}
          </span>
        )}
      </div>
      {/* Ход ластика под фото: первая загрузка модели — с процентом; «Отмена» — для «Убрать», нажатого сейчас */}
      {erasing && eraseFail !== eKey && (
        <div className="pe-erase" aria-busy="true">
          <span className="small" role="status" aria-live="polite">
            {eLoading ? `Загружаем ластик на устройство: ${ePct}% (один раз, около ${ERASER_MB} МБ)` : "Убираем выделенное…"}
          </span>
          <progress className="pe-progress" max={100} value={eLoading ? ePct : undefined} aria-label="Ластик" />
          {cancelableErase && eraseOps.some((o) => o.id === cancelableErase) && (
            <button type="button" className="btn btn-small" onClick={onCancelErase}>
              Отмена
            </button>
          )}
        </div>
      )}
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
