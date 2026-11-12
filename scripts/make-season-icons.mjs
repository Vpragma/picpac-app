// N2 · сезонный вариант иконки уведомлений: белый логотип PicPac (та же форма, без теней и поворотов)
// в круге цвета сезона. Запуск: node scripts/make-season-icons.mjs → public/icons/season/icon-<сезон>-192.png
// Цвета — логотип сезона из lib/seasonShared.js (SEASON_LOGO.light): осень — терракота, «Чёрная пятница» — почти чёрный, Новый год — глубокий зелёный.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { SEASON_LOGO } from "../lib/seasonShared.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "icons", "season");
mkdirSync(OUT, { recursive: true });

const src = readFileSync(join(ROOT, "public", "logo.svg"), "utf8");
const white = src.replaceAll(/fill="#DD5757"/gi, 'fill="#FFFFFF"');
if (white === src) throw new Error("В logo.svg не нашёлся fill=#DD5757");
const big = await sharp(Buffer.from(white), { density: 72 * 8 }).png().toBuffer();
const trimmed = await sharp(big).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer({ resolveWithObject: true });

const size = 192;
const lw = Math.round(size * 0.62);
const lh = Math.round((lw * trimmed.info.height) / trimmed.info.width);
const logo = await sharp(trimmed.data).resize(lw, lh, { kernel: "lanczos3" }).png().toBuffer();
for (const [season, c] of Object.entries(SEASON_LOGO)) {
  const bg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${c.light}"/></svg>`);
  const buf = await sharp(bg)
    .composite([{ input: logo, left: Math.round((size - lw) / 2), top: Math.round((size - lh) / 2) }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  writeFileSync(join(OUT, `icon-${season}-192.png`), buf);
  console.log(`icon-${season}-192.png`, buf.length + " Б");
}
