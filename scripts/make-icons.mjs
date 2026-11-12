// Генерация иконок PWA PicPac из public/logo.svg (запуск из папки picpac-app: node <путь>/make-icons.mjs [папка-вывода]).
// Бренд: белый логотип в красном круге #DD5757, без теней и искажений (docs/brand/brandbook.md, п. 2).
//   icon-192.png, icon-512.png            — purpose "any": красный круг, углы прозрачные
//   icon-maskable-512.png                 — purpose "maskable": красный квадрат на весь холст, логотип в безопасной зоне (круг 80%)
//   apple-icon.png (180×180)              — apple-touch-icon: красный квадрат без прозрачности (iOS сам скругляет углы)
//   favicon-32.png, favicon-48.png, favicon.ico (16+32+48), icon.svg (вектор: круг + логотип)
//   splash/apple-splash-<ширина>x<высота>.png — экраны запуска iOS (красный круг с логотипом на фоне #faf5ed); подключаются через metadata.appleWebApp.startupImage
//   badge-96.png                          — значок для пуш-уведомлений Android: белый логотип на прозрачном фоне (система красит сама)
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// sharp берём из picpac-app (рядом с этим скриптом лежит копия только в черновиках)
const APP = process.env.PICPAC_APP || "/Users/user/Documents/hackathon/picpac-app";
const require = createRequire(join(APP, "package.json"));
const sharp = require("sharp");

const RED = "#DD5757";
const OUT = resolve(process.argv[2] || HERE);
mkdirSync(OUT, { recursive: true });

// 1. Логотип: перекрашиваем fill в белый, форму не трогаем
const src = readFileSync(join(APP, "public/logo.svg"), "utf8");
const whiteSvg = src.replaceAll(/fill="#DD5757"/gi, 'fill="#FFFFFF"');
if (whiteSvg === src) throw new Error("В logo.svg не нашёлся fill=#DD5757 — проверьте файл");

// 2. Плотная рамка логотипа (без пустых полей viewBox), чтобы центрировать по самому рисунку
const big = await sharp(Buffer.from(whiteSvg), { density: 72 * 8 }).png().toBuffer(); // 8x от 144×80
const trimmed = await sharp(big).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer({ resolveWithObject: true });
const logoW = trimmed.info.width, logoH = trimmed.info.height;
console.log(`logo bbox (8x): ${logoW}×${logoH}, aspect ${(logoW / logoH).toFixed(3)}`);

// 3. Холст: фон + логотип по центру, ширина логотипа — доля от стороны
async function compose({ size, shape, share }) {
  const lw = Math.round(size * share);
  const lh = Math.round((lw * logoH) / logoW);
  const logo = await sharp(trimmed.data).resize(lw, lh, { kernel: "lanczos3" }).png().toBuffer();
  const bg =
    shape === "circle"
      ? Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${RED}"/></svg>`)
      : Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="${RED}"/></svg>`);
  return sharp(bg)
    .composite([{ input: logo, left: Math.round((size - lw) / 2), top: Math.round((size - lh) / 2) }])
    .png({ compressionLevel: 9 });
}

// Доли ширины логотипа. Диагональ рамки логотипа = 0,572·ширина → при 0,62 от диаметра она занимает 71% диаметра (внутри круга),
// для maskable при 0,60 — 69% стороны: целиком внутри безопасного круга 80% (требование W3C maskable).
const jobs = [
  ["icon-192.png", { size: 192, shape: "circle", share: 0.62 }],
  ["icon-512.png", { size: 512, shape: "circle", share: 0.62 }],
  ["icon-maskable-512.png", { size: 512, shape: "square", share: 0.6 }],
  ["apple-icon.png", { size: 180, shape: "square", share: 0.66 }],
  ["favicon-32.png", { size: 32, shape: "circle", share: 0.7 }],
  ["favicon-48.png", { size: 48, shape: "circle", share: 0.7 }],
  ["favicon-16.png", { size: 16, shape: "circle", share: 0.74 }],
];
const made = {};
for (const [name, opt] of jobs) {
  const img = await compose(opt);
  const buf = await img.toBuffer();
  writeFileSync(join(OUT, name), buf);
  made[name] = buf;
  console.log(name.padEnd(24), opt.size + "×" + opt.size, buf.length + " Б");
}

// badge-96.png: только белая форма на прозрачном фоне
{
  const lw = Math.round(96 * 0.84), lh = Math.round((lw * logoH) / logoW);
  const logo = await sharp(trimmed.data).resize(lw, lh, { kernel: "lanczos3" }).png().toBuffer();
  const buf = await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, left: Math.round((96 - lw) / 2), top: Math.round((96 - lh) / 2) }]).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(join(OUT, "badge-96.png"), buf);
  console.log("badge-96.png".padEnd(24), "96×96", buf.length + " Б");
}

// 4. favicon.ico: контейнер ICO с PNG внутри (16, 32, 48) — поддерживается всеми современными браузерами
function ico(pngs) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = [], data = [];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(offset, 12);
    dir.push(e); data.push(buf); offset += buf.length;
  }
  return Buffer.concat([head, ...dir, ...data]);
}
writeFileSync(join(OUT, "favicon.ico"), ico([{ size: 16, buf: made["favicon-16.png"] }, { size: 32, buf: made["favicon-32.png"] }, { size: 48, buf: made["favicon-48.png"] }]));
console.log("favicon.ico".padEnd(24), "16+32+48");

// 5. icon.svg: красный круг + белый логотип (те же path, масштаб в круг; без обводки и эффектов)
// Исходный viewBox логотипа 144×80; ставим его по центру круга 100×100 с масштабом, чтобы ширина рисунка была ≈ 62 пункта.
const paths = [...src.matchAll(/<path\b[^>]*?\sd="([^"]+)"[^>]*>/g)].map((m) => `<path fill="#FFFFFF" d="${m[1]}"/>`).join("\n  ");
if (!paths) throw new Error("В logo.svg не нашлись path");
// положение плотной рамки: из растра (8x) → в единицах viewBox
const full = await sharp(Buffer.from(whiteSvg), { density: 72 * 8 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = full.info.width, minY = full.info.height, maxX = 0, maxY = 0;
for (let y = 0; y < full.info.height; y++) for (let x = 0; x < full.info.width; x++) if (full.data[(y * full.info.width + x) * 4 + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
const k = 8; // растр в 8 раз больше viewBox
const bx = minX / k, by = minY / k, bw = (maxX - minX + 1) / k, bh = (maxY - minY + 1) / k;
const scale = 62 / bw;
const tx = 50 - (bx + bw / 2) * scale, ty = 50 - (by + bh / 2) * scale;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <circle cx="50" cy="50" r="50" fill="${RED}"/>
  <g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(4)})">
  ${paths}
  </g>
</svg>
`;
writeFileSync(join(OUT, "icon.svg"), svg);
console.log("icon.svg".padEnd(24), `bbox viewBox: x=${bx.toFixed(1)} y=${by.toFixed(1)} w=${bw.toFixed(1)} h=${bh.toFixed(1)}`);

// 6. Экраны запуска iOS (apple-touch-startup-image). Размеры — в физических пикселях; media-запрос в layout.js строится из них.
// На устройствах, чьего размера нет в списке, iOS просто покажет фон без картинки (не ошибка). Не проверено на телефоне.
const SPLASH = [
  // [css-ширина, css-высота, dpr]
  [430, 932, 3], // iPhone 14 Pro Max / 15 Plus / 15 Pro Max / 16 Plus
  [393, 852, 3], // iPhone 14 Pro / 15 / 15 Pro / 16
  [428, 926, 3], // iPhone 12/13 Pro Max / 14 Plus
  [390, 844, 3], // iPhone 12 / 13 / 14
  [375, 812, 3], // iPhone X / XS / 11 Pro / 12-13 mini
  [414, 896, 2], // iPhone XR / 11
  [375, 667, 2], // iPhone SE / 8
];
mkdirSync(join(OUT, "splash"), { recursive: true });
const iconBuf = made["icon-512.png"];
const lines = [];
for (const [cw, ch, dpr] of SPLASH) {
  const w = cw * dpr, h = ch * dpr, d = Math.round(Math.min(w, h) * 0.3);
  const circle = await sharp(iconBuf).resize(d, d, { kernel: "lanczos3" }).png().toBuffer();
  const buf = await sharp({ create: { width: w, height: h, channels: 3, background: "#faf5ed" } })
    .composite([{ input: circle, left: Math.round((w - d) / 2), top: Math.round((h - d) / 2) - Math.round(h * 0.03) }])
    .png({ compressionLevel: 9 }).toBuffer();
  const name = `apple-splash-${w}x${h}.png`;
  writeFileSync(join(OUT, "splash", name), buf);
  lines.push(`    { url: "/splash/${name}", media: "(device-width: ${cw}px) and (device-height: ${ch}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" },`);
  console.log(("splash/" + name).padEnd(34), buf.length + " Б");
}
writeFileSync(join(OUT, "splash", "startup-image.snippet.txt"), "// metadata.appleWebApp.startupImage\n[\n" + lines.join("\n") + "\n]\n");
