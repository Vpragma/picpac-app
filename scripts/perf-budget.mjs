// N5 · бюджет скорости: сколько JS (сжатого gzip) грузит каждая страница при первом входе и нет ли в нём тяжёлого
// (ИИ-библиотеки, перетаскивание, модерация). Нужен запущенный сервер:
//   npm run build && npx next start -H 127.0.0.1 -p 3308
//   BASE_URL=http://127.0.0.1:3308 npm run perf:budget
// Падает (код 1), если страница превысила бюджет или в первом JS страницы нашлась запрещённая библиотека.
// Только открытые страницы (без входа); админку проверяет Lighthouse со входом (docs/test-report.md, N5).
import { gzipSync } from "node:zlib";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

// Бюджеты, КБ сжатого JS (фреймворк React + Next ≈ 131 КБ входит). Было до N5: главная 166, редактор 195.
const PAGES = [
  { path: "/", budget: 175, forbid: ["onnx", "transformers", "tfjs", "dnd", "onboarding"] },
  { path: "/product/photopaper-book", budget: 175, forbid: ["onnx", "transformers", "tfjs", "dnd"] },
  { path: "/editor", budget: 185, forbid: ["onnx", "transformers", "tfjs", "dnd"] },
  { path: "/books", budget: 180, forbid: ["onnx", "transformers", "tfjs", "dnd"] },
  { path: "/cart", budget: 180, forbid: ["onnx", "transformers", "tfjs", "dnd"] },
];

// Отличительные строки библиотек в собранных файлах
const MARKERS = {
  onnx: /InferenceSession/,
  transformers: /huggingface|AutoProcessor/,
  tfjs: /tfjs|UpscalerJS|@tensorflow/,
  dnd: /DndDescribedBy/,
  onboarding: /onboarding-card/, // сам онбординг (флаг pp:onboarding читает лёгкая обёртка OnboardingLazy)
};

async function text(url) {
  const res = await fetch(url, { headers: { "Accept-Encoding": "identity" } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

let failed = false;
console.log(`Бюджет JS первой загрузки (${BASE}):`);
for (const page of PAGES) {
  const html = await text(BASE + page.path);
  // Скрипты страницы: <script src> (кроме nomodule — полифилы старых браузеров современные не качают)
  const srcs = [...html.matchAll(/<script\b([^>]*)>/g)]
    .map((m) => m[1])
    .filter((attrs) => !/\bnoModule\b|\bnomodule\b/i.test(attrs))
    .map((attrs) => attrs.match(/\bsrc="([^"]+)"/)?.[1])
    .filter(Boolean);
  let total = 0;
  const found = new Set();
  for (const src of [...new Set(srcs)]) {
    const js = await text(new URL(src, BASE).href);
    total += gzipSync(js).length;
    for (const [name, re] of Object.entries(MARKERS)) if (re.test(js)) found.add(name);
  }
  const kb = Math.round(total / 1024);
  const bad = page.forbid.filter((f) => found.has(f));
  const ok = kb <= page.budget && !bad.length;
  if (!ok) failed = true;
  console.log(`${ok ? "✓" : "✗"} ${page.path.padEnd(26)} ${String(kb).padStart(4)} КБ из ${page.budget}, скриптов ${srcs.length}${bad.length ? " — лишнее: " + bad.join(", ") : ""}`);
}
if (failed) {
  console.log("\nБюджет превышен: тяжёлое — в воркер или отдельным куском (next/dynamic, import() по требованию). См. docs/night/track2-n5.md.");
  process.exit(1);
}
console.log("\nВсё в бюджете.");
