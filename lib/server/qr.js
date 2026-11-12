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

export async function qrSvg(text, { margin = 2 } = {}) {
  try {
    return await QRCode.toString(text, { type: "svg", margin, errorCorrectionLevel: "M", color: { dark: "#111111", light: "#ffffff" } });
  } catch {
    return "";
  }
}
