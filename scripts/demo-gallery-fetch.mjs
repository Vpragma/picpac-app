// Скачивает исходные фото для тестовой галереи с Wikimedia Commons.
// Только свободные лицензии: CC0, Public domain, CC BY (без SA, если нашлось).
// Запуск: node scripts/demo-gallery-fetch.mjs <папка-для-исходников> [slug1,slug2 — докачать только эти]
// Результат: файлы <slug>.jpg и meta.json (источник, автор, лицензия) в этой папке.
// Дальше их сжимает и портит scripts/demo-gallery-build.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("Укажите папку: node scripts/demo-gallery-fetch.mjs <папка>");
  process.exit(1);
}
mkdirSync(out, { recursive: true });

const UA = "PicPacHackathonDemo/1.0 (test gallery for a hackathon app; github.com/Vpragma)";
const API = "https://commons.wikimedia.org/w/api.php";

// slug, поисковый запрос, зачем нужно фото
const WANT = [
  ["mir-castle", "Mir Castle Belarus", "хорошее: замок, архитектура"],
  ["nesvizh", "Nesvizh Castle", "хорошее: замок"],
  ["braslav-lake", "Braslaw lakes", "хорошее: озёра, горизонт"],
  ["bison", "wisent Bialowieza", "хорошее: животное"],
  ["dog", "dog playing grass", "хорошее: собака"],
  ["cat", "cat sleeping", "хорошее: кошка"],
  ["cake", "birthday cake candles", "хорошее: праздник"],
  ["autumn-forest", "autumn forest path", "хорошее: осенний лес"],
  ["sunset-sun", "sunset sun over sea", "солнце в кадре"],
  ["night-street", "night street lights city", "тёмное: вечерний снимок"],
  ["pool", "outdoor swimming pool blue water", "бассейн без людей (цензура не должна срабатывать)"],
  ["beach", "Baltic Sea beach dunes", "пляж без людей (цензура не должна срабатывать)"],
  ["hiker", "man walking on pier", "посторонний человек на фоне"],
  ["winter-field", "snowy field winter sunny", "яркое: снег"],
  ["flowers", "meadow flowers summer", "хорошее: цветы"],
];

const GOOD_LICENSE = /^(cc0|public domain|pd|cc by \d|cc-by-\d|cc by \d\.\d)/i;
const SA_LICENSE = /^cc by-sa/i;

const strip = (html) => String(html || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(query, quality) {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap${quality ? " incategory:Quality_images" : ""}`,
    gsrnamespace: "6",
    gsrlimit: "15",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "1600",
  });
  let res = await fetch(`${API}?${params}`, { headers: { "User-Agent": UA } });
  // Commons ограничивает частоту: при 429 ждём и пробуем ещё раз
  for (let i = 0; res.status === 429 && i < 3; i++) {
    await pause(15000 * (i + 1));
    res = await fetch(`${API}?${params}`, { headers: { "User-Agent": UA } });
  }
  if (!res.ok) throw new Error(`Commons API ${res.status}`);
  const data = await res.json();
  const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
  return pages
    .map((p) => {
      const ii = p.imageinfo?.[0];
      if (!ii) return null;
      const m = ii.extmetadata || {};
      return {
        title: p.title,
        page: ii.descriptionurl,
        thumb: ii.thumburl || ii.url,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        license: strip(m.LicenseShortName?.value),
        licenseUrl: strip(m.LicenseUrl?.value),
        artist: strip(m.Artist?.value) || "не указан",
        restrictions: strip(m.Restrictions?.value),
      };
    })
    .filter(Boolean)
    .filter((c) => c.mime === "image/jpeg" && c.width >= 1600 && c.width / c.height < 2.2 && c.height / c.width < 1.6)
    .filter((c) => !/personality|trademark/i.test(c.restrictions))
    // Снимки со спутника и аэрофото не подходят для фотокниги
    .filter((c) => !/orthophoto|satellite|landsat|aerial|map/i.test(c.title));
}

const only = process.argv[3] ? new Set(process.argv[3].split(",")) : null;
const metaFile = join(out, "meta.json");
const meta = only && existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, "utf8")).filter((m) => !only.has(m.slug)) : [];
for (const [slug, query, purpose] of WANT) {
  if (only && !only.has(slug)) continue;
  let picked = null;
  for (const quality of [true, false]) {
    let list = [];
    try {
      list = await search(query, quality);
    } catch (e) {
      console.error(`! ${slug}: ${e.message}`);
      await pause(2000);
      continue;
    }
    picked = list.find((c) => GOOD_LICENSE.test(c.license)) || list.find((c) => SA_LICENSE.test(c.license)) || null;
    if (picked) break;
    await pause(3000);
  }
  if (!picked) {
    console.error(`× ${slug}: не нашлось фото со свободной лицензией`);
    continue;
  }
  try {
    const res = await fetch(picked.thumb, { headers: { "User-Agent": UA } });
    if (!res.ok) throw new Error(`скачивание ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(out, `${slug}.jpg`), buf);
    meta.push({ slug, purpose, ...picked, bytes: buf.length });
    console.log(`✓ ${slug}: ${picked.title} · ${picked.license} · ${Math.round(buf.length / 1024)} КБ`);
  } catch (e) {
    console.error(`! ${slug}: ${e.message}`);
  }
  await pause(4000);
}
writeFileSync(metaFile, JSON.stringify(meta, null, 2));
console.log(`Готово: ${meta.length} фото из ${WANT.length}`);
