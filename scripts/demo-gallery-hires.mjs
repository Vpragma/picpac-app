// Тестовая галерея (дорожка ED, 12.11): «хорошим» фото — файл ≥ 3000 точек по длинной стороне (чтобы на 21×30
// предупреждения о резкости ловили только «плохие»), и лёгкие превью ~300 точек для сетки галереи.
// Источник — Wikimedia Commons (Special:FilePath с шириной), лицензии и авторы — manifest.json и docs/test-photos/sources.md.
// Запуск: node scripts/demo-gallery-hires.mjs [--thumbs-only]
import sharp from "sharp";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const DIR = new URL("../public/demo-gallery/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", DIR), "utf8"));
const BAD = new Set(["dark", "overexposed", "color-cast", "blurry", "low-resolution", "duplicate", "tilted"]);
const LONG = 3000;
const MAX_BYTES = 900_000;
const thumbsOnly = process.argv.includes("--thumbs-only");

async function hires(it) {
  // уже большой файл (повторный запуск) — не качаем заново
  const local = await sharp(readFileSync(new URL(it.file, DIR))).metadata();
  if (Math.max(local.width, local.height) >= 2400) {
    Object.assign(it, { width: local.width, height: local.height, bytes: readFileSync(new URL(it.file, DIR)).length });
    return console.log(it.file, "уже", local.width + "×" + local.height);
  }
  const name = it.original;
  const portrait = it.height > it.width;
  // для вертикальных — ширина меньше: просим ширину так, чтобы длинная сторона была ≥ 3000
  const width = portrait ? Math.ceil((LONG * it.width) / it.height) + 40 : LONG + 100;
  const url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + encodeURIComponent(name.replace(/ /g, "_")) + "?width=" + width;
  const res = await fetch(url, { headers: { "User-Agent": "PicPac-hackathon-demo/1.0 (test gallery; contact via GitHub Vpragma)" }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(it.file + ": HTTP " + res.status);
  const src = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(src).metadata();
  const long = Math.max(meta.width, meta.height);
  // исходник чуть меньше 3000 (Несвиж — 2989) — берём как есть, без растягивания
  if (long < 2400) throw new Error(`${it.file}: исходник только ${meta.width}×${meta.height}`);
  const target = Math.min(LONG, long);
  let out;
  for (const q of [80, 74, 68, 62, 56]) {
    out = await sharp(src).rotate().resize({ width: portrait ? undefined : target, height: portrait ? target : undefined, fit: "inside" }).jpeg({ quality: q, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_BYTES) break;
  }
  const m2 = await sharp(out).metadata();
  writeFileSync(new URL(it.file, DIR), out);
  it.width = m2.width;
  it.height = m2.height;
  it.bytes = out.length;
  it.modified = `уменьшено до ${Math.max(m2.width, m2.height)} точек по длинной стороне и сжато`;
  console.log(it.file, m2.width + "×" + m2.height, Math.round(out.length / 1024) + " КБ");
}

async function thumb(it) {
  mkdirSync(new URL("thumbs/", DIR), { recursive: true });
  const buf = await sharp(readFileSync(new URL(it.file, DIR))).rotate().resize({ width: 300, height: 300, fit: "inside" }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
  writeFileSync(new URL("thumbs/" + it.file, DIR), buf);
  it.thumb = "thumbs/" + it.file;
  return buf.length;
}

if (!thumbsOnly) {
  for (const it of manifest.items) {
    if (it.problem && BAD.has(it.problem)) continue;
    for (let a = 1; ; a++) {
      try {
        await hires(it);
        break;
      } catch (e) {
        console.error("повтор", a, e.message);
        if (a >= 3) throw e;
      }
    }
  }
}
let total = 0;
for (const it of manifest.items) total += await thumb(it);
console.log("превью:", manifest.items.length, "шт., всего", Math.round(total / 1024), "КБ");
writeFileSync(new URL("manifest.json", DIR), JSON.stringify(manifest, null, 2) + "\n");
