// Собирает тестовую галерею: уменьшает фото до 1600 px, сжимает до 400 КБ,
// делает испорченные версии (темнее, пересвет, жёлтый оттенок, размытие, маленькое, завал горизонта, дубль).
// Работает без нативных модулей: canvas в установленном Chrome через Playwright.
// Запуск: node scripts/demo-gallery-build.mjs <папка-исходников с meta.json> <путь к docs/test-photos/sources.md>
// Результат: public/demo-gallery/*.jpg, public/demo-gallery/manifest.json, sources.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const [rawDir, sourcesFile] = process.argv.slice(2);
if (!rawDir || !sourcesFile) {
  console.error("Использование: node scripts/demo-gallery-build.mjs <папка-исходников> <sources.md>");
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "demo-gallery");
mkdirSync(outDir, { recursive: true });
const meta = Object.fromEntries(JSON.parse(readFileSync(join(rawDir, "meta.json"), "utf8")).map((m) => [m.slug, m]));

const MAX_BYTES = 400 * 1024;

// file, исходник, подпись, проблема (null — хорошее фото), что должно показать приложение, обработка
const ITEMS = [
  ["mir-castle", "mir-castle", "Мирский замок", null, "Хорошее фото: предупреждений нет", {}],
  ["nesvizh", "nesvizh", "Несвижский замок", null, "Хорошее фото: предупреждений нет", {}],
  ["braslav-lake", "braslav-lake", "Браславские озёра", null, "Хорошее фото, вертикальное", {}],
  ["bison", "bison", "Зубр в заповеднике", null, "Хорошее фото: предупреждений нет", {}],
  ["dog", "dog", "Собака с мячом", null, "Хорошее фото: предупреждений нет", {}],
  ["cat", "cat", "Кот на ковре", null, "Хорошее фото: предупреждений нет", {}],
  ["autumn-forest", "autumn-forest", "Осенний лес", null, "Хорошее фото: предупреждений нет", {}],
  ["flowers", "flowers", "Луговая герань", null, "Хорошее фото, вертикальное", {}],
  ["beach", "beach", "Дюны у моря", "beach", "Пляж без людей: цензура не должна срабатывать", {}],
  ["sunset-sun", "sunset-sun", "Закат над морем", "sun", "Солнце в кадре: подходит для команды «убери солнце»", {}],
  ["winter-field", "winter-field", "Зимний туман", "backlight", "Контровой свет и солнце: автоулучшение вытягивает тени", {}],
  ["night-street", "night-street", "Ночной город", "dark", "Вечерний снимок: тёмный, автоулучшение осветляет", {}],
  ["cake", "cake", "Торт на день рождения", "stranger", "Люди на заднем плане: можно убрать ластиком", {}],
  ["cat-dark", "cat", "Кот на ковре — темно", "dark", "Слишком тёмное: подсказка «Осветлить»", { filter: "brightness(0.32)" }],
  ["braslav-lake-bright", "braslav-lake", "Озёра — пересвет", "overexposed", "Пересвет: подсказка «Убрать пересвет»", { filter: "brightness(1.85) contrast(0.75)" }],
  ["bison-yellow", "bison", "Зубр — жёлтый оттенок", "color-cast", "Жёлтый оттенок: подсказка «Баланс белого»", { multiply: "rgb(255, 222, 110)" }],
  ["dog-blurry", "dog", "Собака — смазано", "blurry", "Размыто: предупреждение о резкости", { filter: "blur(7px)" }],
  ["nesvizh-small", "nesvizh", "Несвиж — маленькое", "low-resolution", "800 px: предупреждение «Будет размыто» на большом формате", { maxSide: 800 }],
  ["sunset-sun-tilted", "sunset-sun", "Закат — завален горизонт", "tilted", "Горизонт завален на 5°: подсказка «Выровнять горизонт»", { rotate: 5 }],
  ["flowers-2", "flowers", "Луговая герань — дубль", "duplicate", "Почти такой же кадр, как «Луговая герань»: поиск дублей", { crop: 0.9, filter: "brightness(1.06)" }],
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
const manifest = [];
try {
  for (const [file, src, title, problem, expected, fx] of ITEMS) {
    const m = meta[src];
    if (!m) {
      console.error(`× ${file}: нет исходника ${src}`);
      continue;
    }
    const input = "data:image/jpeg;base64," + readFileSync(join(rawDir, `${src}.jpg`)).toString("base64");
    const res = await page.evaluate(
      async ({ input, fx, maxBytes }) => {
        const img = new Image();
        img.src = input;
        await img.decode();
        const maxSide = fx.maxSide || 1600;
        const crop = fx.crop || 1;
        const sw = img.naturalWidth * crop;
        const sh = img.naturalHeight * crop;
        const sx = (img.naturalWidth - sw) * 0.3;
        const sy = (img.naturalHeight - sh) * 0.5;
        const scale = Math.min(1, maxSide / Math.max(sw, sh));
        const w = Math.round(sw * scale);
        const h = Math.round(sh * scale);
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.imageSmoothingQuality = "high";
        if (fx.rotate) {
          // Поворот с увеличением, чтобы не было пустых углов
          const a = (fx.rotate * Math.PI) / 180;
          const zoom = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)) * Math.max(w / h, h / w);
          ctx.translate(w / 2, h / 2);
          ctx.rotate(a);
          ctx.scale(zoom, zoom);
          ctx.translate(-w / 2, -h / 2);
        }
        if (fx.filter) ctx.filter = fx.filter;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.filter = "none";
        if (fx.multiply) {
          ctx.globalCompositeOperation = "multiply";
          ctx.fillStyle = fx.multiply;
          ctx.fillRect(0, 0, w, h);
          ctx.globalCompositeOperation = "source-over";
        }
        let q = 0.86;
        let url = c.toDataURL("image/jpeg", q);
        while ((url.length - 23) * 0.75 > maxBytes && q > 0.4) {
          q -= 0.06;
          url = c.toDataURL("image/jpeg", q);
        }
        return { url, w, h, q: Math.round(q * 100) };
      },
      { input, fx, maxBytes: MAX_BYTES },
    );
    const buf = Buffer.from(res.url.split(",")[1], "base64");
    writeFileSync(join(outDir, `${file}.jpg`), buf);
    manifest.push({
      file: `${file}.jpg`,
      title,
      problem,
      expected,
      width: res.w,
      height: res.h,
      bytes: buf.length,
      license: m.license,
      licenseUrl: m.licenseUrl || null,
      author: m.artist,
      source: m.page,
      original: m.title.replace(/^File:/, ""),
      modified: Object.keys(fx).length ? describe(fx) : "уменьшено и сжато",
    });
    console.log(`✓ ${file}.jpg ${res.w}×${res.h} ${Math.round(buf.length / 1024)} КБ q=${res.q}`);
  }
} finally {
  await browser.close();
}

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ version: 1, note: "Тестовая галерея PicPac. Фото со свободной лицензией, источники — docs/test-photos/sources.md", items: manifest }, null, 2) + "\n",
);

const rows = manifest.map(
  (x) => `| \`${x.file}\` | ${x.title} | [${x.original.replace(/\|/g, "\\|")}](${x.source}) | ${x.author.replace(/\|/g, "\\|")} | ${x.licenseUrl ? `[${x.license}](${x.licenseUrl})` : x.license} | ${x.modified} |`,
);
writeFileSync(
  sourcesFile,
  `# Источники тестовых фото

Все фото — с Wikimedia Commons, свободные лицензии (CC0, общественное достояние, CC BY, CC BY-SA).
Сжатые копии лежат в \`picpac-app/public/demo-gallery/\`, описание каждого — в \`manifest.json\` там же.
Испорченные версии сделаны программно скриптом \`picpac-app/scripts/demo-gallery-build.mjs\` (canvas в Chrome);
изменённые версии фото под CC BY-SA распространяются на тех же условиях.

Собрать заново: \`node scripts/demo-gallery-fetch.mjs <папка>\`, затем \`node scripts/demo-gallery-build.mjs <папка> ../docs/test-photos/sources.md\`.

| Файл | Что на фото | Оригинал | Автор | Лицензия | Изменения |
|---|---|---|---|---|---|
${rows.join("\n")}
`,
);
console.log(`Готово: ${manifest.length} фото, manifest.json и sources.md`);

function describe(fx) {
  const parts = ["уменьшено и сжато"];
  if (fx.filter?.includes("brightness(0")) parts.push("затемнено");
  else if (fx.filter?.includes("brightness(1.8")) parts.push("пересвечено");
  else if (fx.filter?.includes("brightness(1.0")) parts.push("чуть светлее");
  if (fx.filter?.includes("blur")) parts.push("размыто");
  if (fx.multiply) parts.push("жёлтый оттенок");
  if (fx.maxSide) parts.push(`до ${fx.maxSide} px`);
  if (fx.rotate) parts.push(`повёрнуто на ${fx.rotate}°`);
  if (fx.crop) parts.push("кадрировано");
  return parts.join(", ");
}
