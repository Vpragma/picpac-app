import "server-only";
// QR-код как inline SVG на сервере (D9): npm qrcode (MIT), без внешних сервисов и без JS в браузере.
import QRCode from "qrcode";
import { headers } from "next/headers";

export const MAIN_SITE = "https://picpac-app-jade.vercel.app";

// Адрес текущего сайта: на основном сайте — основной адрес, на превью — адрес превью, локально — localhost
export async function siteUrl() {
  const h = await headers();
  const host = (h.get("x-forwarded-host") || h.get("host") || "").toLowerCase();
  if (!/^[a-z0-9.-]{1,120}(:\d{1,5})?$/.test(host)) return MAIN_SITE;
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

// N5: готовые SVG в памяти — подвал каждой страницы рисует один и тот же код адреса сайта, считать его на каждый запрос незачем
const svgCache = new Map();

export async function qrSvg(text, { margin = 2 } = {}) {
  const key = margin + " " + text;
  if (svgCache.has(key)) return svgCache.get(key);
  try {
    const svg = await QRCode.toString(text, { type: "svg", margin, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
    if (svgCache.size > 50) svgCache.clear(); // разные адреса (превью, localhost) — не копим без конца
    svgCache.set(key, svg);
    return svg;
  } catch {
    return "";
  }
}
