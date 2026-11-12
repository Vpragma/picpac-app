"use client";
// Облачный ИИ (D6) в браузере: запросы к нашему серверу /api/v1/ai/*. Ключей Cloudflare здесь нет и быть не может —
// облако вызывает только сервер. Кадр перед отправкой уменьшается (до 768 точек) и перекодируется в JPEG через canvas:
// так в нём нет EXIF, GPS и имени файла. Любой сбой → { ok: false, say } — редактор остаётся на правках на устройстве.
import { callApi } from "../api.js";
import { getMe, isClient } from "../me.js";
import { CLOUD_LIMITS, CLOUD_SAY, opsToSteps } from "./shared.js";

let state = null; // { available, consent, left, limit } — на время открытой страницы

export async function cloudState({ fresh = false } = {}) {
  const me = await getMe();
  if (!isClient(me)) return { guest: true };
  if (state && !fresh) return state;
  const r = await callApi("/api/v1/ai/cloud", { method: "GET" });
  if (r.status === 401) return { guest: true };
  if (!r.ok) return { error: true, say: r.status === 0 ? CLOUD_SAY.offline : CLOUD_SAY.unavailable };
  state = { available: !!r.available, consent: !!r.consent, left: r.left, limit: r.limit };
  return state;
}

export async function giveConsent() {
  const r = await callApi("/api/v1/ai/consent", { body: { accept: true } });
  if (r.ok) state = { ...(state || {}), consent: true };
  return r.ok ? { ok: true } : fail(r);
}

export async function revokeConsent() {
  const r = await callApi("/api/v1/ai/consent", { method: "DELETE" });
  if (r.ok) state = { ...(state || {}), consent: false };
  return r.ok ? { ok: true } : fail(r);
}

function fail(r) {
  const code = r.error?.code || (r.status === 0 ? "offline" : "error");
  if (state) {
    if (code === "ai_consent_required") state = { ...state, consent: false };
    if (r.status === 429 && code !== "rate_limited") state = { ...state, left: 0 };
  }
  const say = r.status === 0 ? CLOUD_SAY.offline : r.error?.message || CLOUD_SAY.unavailable;
  return { ok: false, code, status: r.status, say };
}

function done(r) {
  if (state && Number.isFinite(r.left)) state = { ...state, left: r.left };
}

// Свободная команда → шаги редактора (те же виды, что у словаря на устройстве)
export async function cloudCommand(text) {
  const r = await callApi("/api/v1/ai/command", { body: { text: String(text).slice(0, 300) } });
  if (!r.ok) return fail(r);
  done(r);
  return { ok: true, steps: opsToSteps(r.ops), say: r.say || "" };
}

// ImageData → JPEG data URL с длинной стороной не больше side (canvas не переносит метаданные)
export function toJpegDataUrl(img, side, quality = 0.85) {
  const k = Math.min(1, side / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const src = document.createElement("canvas");
  src.width = img.width;
  src.height = img.height;
  src.getContext("2d").putImageData(img, 0, 0);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  return out.toDataURL("image/jpeg", quality);
}

// Найти предмет по слову: { ok, boxes: [{ x0, y0, x1, y1 } в долях 0…1], target } или { ok: false, say }
export async function cloudDetect(img, target) {
  const image = toJpegDataUrl(img, CLOUD_LIMITS.detectSide);
  const r = await callApi("/api/v1/ai/detect", { body: { image, target: String(target).slice(0, 60) } });
  if (!r.ok) return fail(r);
  done(r);
  return { ok: true, boxes: Array.isArray(r.boxes) ? r.boxes : [], target: r.target, say: r.say };
}
