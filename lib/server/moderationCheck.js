import "server-only";
// Проверка фото на нашем сервере (N4): клиент не может подделать оценки — сервер сам читает файл из хранилища
// (печатную версию, если она есть, иначе оригинал) и прогоняет те же модели, что и устройство (moderationEngine.js).
//   • сразу после загрузки фото — в фоне (after), чтобы к оформлению заказа почти всё было проверено;
//   • при оформлении заказа — обязательно: непроверенные фото проверяются до создания заказа (снимок берёт флаг).
// Флаг «проверит модератор» только ставится, никогда не снимается автоматикой: оценки с устройства ИЛИ сервер.
// Не успели или не смогли проверить при заказе — фото тоже уходит модератору («автоматическая проверка не прошла»).
// Журнал: решение модели (moderation.auto) — только находки и номер фото, без самого фото.
import { BUCKET } from "./api";
import { findings, needsModeration } from "../moderation";
import { SCORES_VERSION } from "../photo/moderationModel";
import { scoreImage } from "./moderationEngine";

export const CHECK_FIELDS = "id, user_id, project_id, storage_path, print_path, nsfw, moderation, moderation_flag";
const inflight = new Map(); // id фото → проверка (одна на фото в этом экземпляре сервера)

const fileOf = (row) => row.print_path || row.storage_path;
// Проверено сервером именно то, что пойдёт в печать, текущей версией моделей
export const isServerChecked = (row) => !!row?.moderation && !row.moderation.unchecked && row.moderation.path === fileOf(row) && row.moderation.v === SCORES_VERSION;

async function verdictFor(ctx, path) {
  const t = Date.now();
  const at = new Date().toISOString();
  try {
    const { data, error } = await ctx.admin.storage.from(BUCKET).download(path);
    if (error || !data) throw new Error("download_failed");
    const scores = await scoreImage(Buffer.from(await data.arrayBuffer()));
    return { v: SCORES_VERSION, path, at, scores, findings: findings(scores), ms: Date.now() - t };
  } catch (e) {
    console.error("Проверка фото на сервере:", e?.message);
    return { v: SCORES_VERSION, path, at, unchecked: true, error: String(e?.message || e).slice(0, 120), ms: Date.now() - t };
  }
}

// Проверить одно фото и записать вердикт. strict — при оформлении заказа: если проверить не вышло, фото идёт модератору.
export function checkPhoto(ctx, row, { strict = false } = {}) {
  if (isServerChecked(row)) return Promise.resolve(row.moderation);
  const key = row.id + ":" + fileOf(row);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const verdict = await verdictFor(ctx, fileOf(row));
    const flag = verdict.unchecked ? strict : verdict.findings.length > 0;
    const patch = { moderation: verdict, ...(flag ? { moderation_flag: true } : {}) };
    const { error } = await ctx.admin.from("project_photos").update(patch).eq("id", row.id).eq("user_id", row.user_id);
    if (error) console.error("Вердикт проверки фото:", error.message);
    if (flag || verdict.unchecked) {
      const list = verdict.unchecked ? ["unchecked:medium"] : verdict.findings.map((f) => `${f.id}:${f.level}`);
      await ctx.audit("moderation.auto", "photo", row.id, verdict.unchecked ? "error" : "success", {
        project: row.project_id,
        source: "server",
        findings: list,
        flag,
        ms: verdict.ms,
      });
    }
    return verdict;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Фоновая проверка после загрузки фото (ответ клиенту уже ушёл)
export async function checkPhotoById(ctx, photoId) {
  const { data } = await ctx.admin.from("project_photos").select(CHECK_FIELDS).eq("id", photoId).maybeSingle();
  if (data) await checkPhoto(ctx, data);
}

// Перед созданием заказа: все фото проектов корзины, которые сервер ещё не проверил. budgetMs — сколько ждать;
// не успели — фото помечаются «не проверено» и уходят модератору. Ответ: { checked, flagged, unchecked }.
export async function checkProjectsBeforeOrder(ctx, projectIds, { budgetMs = 45_000 } = {}) {
  const res = { checked: 0, flagged: 0, unchecked: 0 };
  if (!projectIds.length) return res;
  const { data, error } = await ctx.admin.from("project_photos").select(CHECK_FIELDS).in("project_id", projectIds).eq("user_id", ctx.userId);
  if (error) throw new Error(error.message);
  const todo = data.filter((r) => !isServerChecked(r));
  const until = Date.now() + budgetMs;
  for (const row of todo) {
    if (Date.now() > until) {
      const verdict = { v: SCORES_VERSION, path: fileOf(row), at: new Date().toISOString(), unchecked: true, error: "time_budget" };
      await ctx.admin.from("project_photos").update({ moderation: verdict, moderation_flag: true }).eq("id", row.id).eq("user_id", row.user_id);
      res.unchecked++;
      continue;
    }
    const v = await checkPhoto(ctx, row, { strict: true });
    res.checked++;
    if (v.unchecked) {
      // могла вернуться фоновая проверка без strict — флаг ставим здесь
      await ctx.admin.from("project_photos").update({ moderation_flag: true }).eq("id", row.id).eq("user_id", row.user_id);
      res.unchecked++;
    } else if (v.findings.length || needsModeration(row.nsfw)) res.flagged++;
  }
  if (res.unchecked) await ctx.audit("moderation.auto", "project", projectIds[0], "error", { source: "server", unchecked: res.unchecked, reason: "not_checked_before_order" });
  return res;
}
