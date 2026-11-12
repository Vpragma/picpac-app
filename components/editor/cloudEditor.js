"use client";
// Облачный ИИ в редакторе (D6): вся логика здесь, в PhotoEditor — только точки вызова.
// getCtx() отдаёт свежие функции и состояние редактора (после каждого ответа облака берём заново:
// пока ждали, пользователь мог выбрать другое фото — тогда ответ молча отбрасываем).
// Любой отказ облака (гость, нет согласия, лимит, нет сети, не нашёл) — откат на устройство:
// словарь команд и выделение касанием.
import { segmentPoints } from "../../lib/photo/ai";
import { maskArea } from "../../lib/photo/mask";
import { cloudCommand, cloudDetect, cloudState } from "../../lib/cloudAi/client";
import { CLOUD_SAY, boxPoint, clipMaskToBox, unionMasks } from "../../lib/cloudAi/shared";

// Один облачный запрос за раз: двойное нажатие не тратит лишнюю правку из дневного лимита
let busy = false;
const BUSY_SAY = "Облачный ИИ ещё думает над прошлой командой — секунду.";

const same = (getCtx, pid) => {
  const c = getCtx();
  return c && c.photoId === pid ? c : null;
};

// Свободная команда, которую не понял словарь на устройстве. local — ответ словаря ({ ok: false, say }).
export async function cloudAsk(text, local, getCtx) {
  const ctx = getCtx();
  if (!ctx || ctx.readOnly) return;
  const pid = ctx.photoId;
  const st = await cloudState();
  const c1 = same(getCtx, pid);
  if (!c1) return;
  if (st.guest) return c1.setAnswer({ ok: false, say: `${local.say} Сложные команды понимает облачный ИИ — он работает после входа.` });
  if (st.error || !st.available) return c1.setAnswer({ ok: false, say: local.say });
  if (!st.consent) {
    c1.setConsentAsk({ kind: "command", text, why: "Эту команду поймёт облачный ИИ" });
    return c1.setAnswer({ ok: false, say: `${local.say} Или разрешите облачный ИИ — ниже.` });
  }
  if (st.left <= 0) return c1.setAnswer({ ok: false, say: `${local.say} ${CLOUD_SAY.quota}` });
  if (busy) return c1.setAnswer({ ok: true, say: BUSY_SAY });
  c1.setAnswer({ ok: true, say: "Спрашиваю облачный ИИ…" });
  busy = true;
  let r;
  try {
    r = await cloudCommand(text);
  } finally {
    busy = false;
  }
  const c2 = same(getCtx, pid);
  if (!c2) return;
  if (!r.ok) return c2.setAnswer({ ok: false, say: `${local.say} ${r.say}` });
  const find = r.steps.find((s) => s.kind === "find");
  const steps = r.steps.filter((s) => s.kind !== "find");
  if (!steps.length && !find) return c2.setAnswer({ ok: false, say: `${r.say ? r.say + ". " : ""}Попробуйте: «ярче», «теплее», «убери пересвет».` });
  if (steps.length) {
    steps[0] = { ...steps[0], say: "Облачный ИИ: " + steps[0].say };
    c2.run(text, { ok: true, steps, say: r.say });
  }
  if (find) cloudFind(find.target, null, getCtx);
}

// Дождаться, пока выделение касанием (SlimSAM) будет готово для этого фото. null — не получилось.
async function waitReady(getCtx, pid, ms = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const c = same(getCtx, pid);
    if (!c) return null;
    const a = c.aiRef.current;
    if (a.photoId === pid && a.status === "ready") return a;
    if (a.status === "error" || a.status === "unsupported" || a.status === "off" || a.photoId !== pid) return null;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// «Убери X» / «найди X» словом: Moondream (сервер) даёт рамки → SlimSAM по рамке → маска.
// act = "erase" — выделенное подсвечено, кнопка «Убрать» выделена; null — просто выделить.
export async function cloudFind(target, act, getCtx) {
  const ctx = getCtx();
  if (!ctx || ctx.readOnly) return;
  const pid = ctx.photoId;
  const touch = act === "erase" ? "Коснитесь того, что убрать, — я выделю, затем нажмите «Убрать»." : "Коснитесь нужного — я выделю.";
  const st = await cloudState();
  const c1 = same(getCtx, pid);
  if (!c1) return;
  if (st.guest || st.error || !st.available || st.left <= 0) {
    c1.startSelect(act);
    const why = st.guest ? `Найти «${target}» по слову может облачный ИИ — он работает после входа.` : st.left <= 0 ? CLOUD_SAY.quota : st.say || CLOUD_SAY.unavailable;
    return c1.setAnswer({ ok: false, say: `${why} ${touch}` });
  }
  if (!st.consent) {
    c1.setConsentAsk({ kind: "find", target, act, why: `Найти «${target}» по слову может облачный ИИ` });
    c1.startSelect(act);
    return c1.setAnswer({ ok: false, say: `${touch} Или разрешите облачный ИИ ниже — он поищет «${target}» сам.` });
  }
  if (busy) return c1.setAnswer({ ok: true, say: BUSY_SAY });
  c1.setAnswer({ ok: true, say: `Ищу «${target}» на фото…` });
  c1.startSelect(act); // выделение готовится на устройстве, пока облако ищет предмет
  let det;
  busy = true;
  try {
    det = await cloudDetect(await c1.getFrame(), target);
  } catch (e) {
    console.error("Облачный поиск:", e);
    det = { ok: false, say: CLOUD_SAY.unavailable };
  } finally {
    busy = false;
  }
  const c2 = same(getCtx, pid);
  if (!c2) return;
  if (!det.ok) return c2.setAnswer({ ok: false, say: `${det.say} ${touch}` });
  if (!det.boxes.length) return c2.setAnswer({ ok: false, say: det.say || `Не нашёл «${target}» на фото. ${touch}` });
  c2.setAnswer({ ok: true, say: `Нашёл «${target}», выделяю…` });
  const a = await waitReady(getCtx, pid);
  if (!a) {
    const c = same(getCtx, pid);
    return c?.setAnswer({ ok: false, say: `Нашёл «${target}», но выделить на этом устройстве не получилось. Попробуйте «Выделить касанием».` });
  }
  let bits = null;
  let w = 0;
  let h = 0;
  try {
    for (const b of det.boxes) {
      const r = await segmentPoints(a.key, [boxPoint(b, a.w, a.h)]);
      w = r.w;
      h = r.h;
      bits = unionMasks(bits, clipMaskToBox(r.mask, r.w, r.h, b));
    }
  } catch (e) {
    console.error("Выделение по рамке:", e);
    bits = null;
  }
  const c3 = same(getCtx, pid);
  if (!c3 || c3.aiRef.current.key !== a.key) return;
  if (!bits || maskArea(bits) < w * h * 0.0005) return c3.setAnswer({ ok: false, say: `Не получилось выделить «${target}». ${touch}` });
  c3.setAi((s) => ({ ...s, points: [], mask: { bits, w, h }, busy: false, pending: act, shown: true }));
  c3.setAnswer({
    ok: true,
    say:
      act === "erase"
        ? `Нашёл и выделил «${target}». Проверьте выделение и нажмите «Убрать» — или коснитесь, чтобы поправить.`
        : `Нашёл и выделил «${target}». Дальше: «Размыть фон», «Осветлить», «Затемнить» или «Убрать».`,
  });
}

// После «Разрешить» — повторить то, ради чего спрашивали согласие
export function cloudRetry(ask, getCtx) {
  if (!ask) return;
  if (ask.kind === "command") return cloudAsk(ask.text, { say: "" }, getCtx);
  if (ask.kind === "find") return cloudFind(ask.target, ask.act, getCtx);
}
