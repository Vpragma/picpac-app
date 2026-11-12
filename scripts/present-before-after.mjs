// Презентация (ночь 2): пары «было / стало» с одинаковых ракурсов — главная, каталог, редактор, корзина, админка.
// «Было» — основной сайт (старый код, открытые экраны гостем; входа нет) и дневной снимок админки (файл);
// «стало» — новая сборка теми же шагами. Каждая пара склеивается в одну картинку: слева «Было», справа «Стало».
//
// Запуск из папки проекта (свой сервер уже запущен):
//   npm run present:before-after -- --base http://127.0.0.1:3000 --out ../docs/presentation/final/before-after
// Параметры:
//   --before       адрес старой версии (по умолчанию https://picpac-app-jade.vercel.app — только открытые экраны)
//   --base         адрес новой версии; --auth-base — для админки «стало» (только 127.0.0.1, по умолчанию = --base)
//   --admin-before снимок админки «было» (PNG компьютера 1440×900 @2x; по умолчанию docs/presentation/screens/09-admin-overview.png
//                  рядом с папкой проекта). Нет файла — пара админки пропускается.
//   --devices desktop,phone    --only before,after,pairs
// В папке: before/…, after/…, пары NN-имя-устройство.png, журнал _log.txt. Аналитика в общую базу не уходит.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { cleanupUsers, createUser, isLocal, loginContext, makeLog, newContext, parseArgs, scrollTop, scrollToEl, settle, stamp, trimBase } from "./present-common.mjs";

const args = parseArgs(process.argv.slice(2), {
  before: "https://picpac-app-jade.vercel.app",
  base: "http://127.0.0.1:3000",
  out: ".night-logs/present-before-after",
  devices: "desktop,phone",
  only: "before,after,pairs",
});
const BEFORE = trimBase(args.before);
const BASE = trimBase(args.base);
const AUTH = trimBase(args["auth-base"] || (isLocal(BASE) ? BASE : ""));
const OUT = path.resolve(args.out);
const DEVICES = args.devices.split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = new Set(args.only.split(",").map((s) => s.trim()));
const ADMIN_BEFORE = [args["admin-before"], "../docs/presentation/screens/09-admin-overview.png", "../../docs/presentation/screens/09-admin-overview.png"]
  .filter(Boolean)
  .map((p) => path.resolve(p))
  .find((p) => fs.existsSync(p));
for (const d of ["before", "after"]) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const log = makeLog(path.join(OUT, "_log.txt"));

// Лёгкие фото тестовой галереи (старый сайт качает их с Vercel)
const PHOTOS = ["cat", "flowers", "cake", "sunset-sun", "winter-field", "nesvizh", "mir-castle", "dog"].map((f) => f + ".jpg");
const VIEWS = [
  ["01-glavnaya", "Главная"],
  ["02-katalog", "Каталог"],
  ["03-redaktor", "Редактор"],
  ["04-korzina", "Корзина"],
  ["05-adminka", "Админка"],
];
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    log(`ok   ${name} (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
    return true;
  } catch (e) {
    results.push({ name, ok: false });
    log(`FAIL ${name}: ${e.message.split("\n")[0].slice(0, 220)}`);
    return false;
  }
}
async function snap(page, file) {
  await page.waitForFunction(() => !document.querySelector(".toast, .toasts > *, [data-toast]"), null, { timeout: 6000 }).catch(() => {});
  await page.screenshot({ path: file });
}
const nav = (page) => page.getByRole("navigation", { name: "Шаги редактора" });

// Одинаковые шаги на обеих версиях (гость)
async function shootSite(browser, kind, base, device) {
  const ctx = await newContext(browser, device, base);
  const page = await ctx.newPage();
  const file = (v) => path.join(OUT, kind, `${v}-${device}.png`);
  const off = device === "phone" ? 70 : 96;
  try {
    await step(`${kind} 01-glavnaya-${device}`, async () => {
      await page.goto(base + "/", { waitUntil: "load", timeout: 120_000 });
      await settle(page, 1500);
      await snap(page, file("01-glavnaya"));
    });
    await step(`${kind} 02-katalog-${device}`, async () => {
      const h = page.getByRole("heading", { name: /Что напечатать/ });
      await scrollToEl(page, h, off + 60);
      await settle(page, 1200);
      await snap(page, file("02-katalog"));
    });
    const editor = await step(`${kind} 03-redaktor-${device}`, async () => {
      await page.goto(base + "/product/layflat", { waitUntil: "load", timeout: 120_000 });
      await page.getByRole("button", { name: "Создать фотокнигу" }).click();
      await page.waitForURL(/\/editor/, { timeout: 60_000 });
      await page.getByRole("button", { name: "Тестовая галерея" }).click();
      const gallery = page.getByRole("region", { name: "Тестовая галерея" });
      await gallery.locator("input[type=checkbox]").first().waitFor({ timeout: 90_000 });
      await gallery.getByRole("button", { name: "Снять выбор" }).click();
      for (const f of PHOTOS) await gallery.locator(`label[data-file="${f}"] input[type=checkbox]`).check();
      await gallery.getByRole("button", { name: `Добавить ${PHOTOS.length} фото` }).click();
      const t0 = Date.now();
      while ((await page.locator(".photo-cell img").count()) < PHOTOS.length) {
        if (Date.now() - t0 > 240_000) throw new Error("фото не добавились за 4 мин");
        await sleep(500);
      }
      await scrollToEl(page, nav(page), device === "phone" ? 150 : 170);
      await settle(page, 1500);
      await snap(page, file("03-redaktor"));
    });
    if (editor)
      await step(`${kind} 04-korzina-${device}`, async () => {
        await nav(page).getByRole("button", { name: "Проверка" }).click();
        const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
        await toCart.waitFor({ timeout: 30_000 });
        for (let i = 0; i < 8 && (await toCart.isDisabled()); i++) {
          const fit = page.getByRole("button", { name: /^Сделать \d+ стр\.$/ }).first();
          const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
          if (await fit.isVisible().catch(() => false)) await fit.click();
          else if (await go.isVisible().catch(() => false)) await go.click();
          await sleep(400);
        }
        await toCart.click();
        await page.waitForURL(/\/cart/, { timeout: 60_000 });
        await settle(page, 1500);
        await scrollTop(page);
        await snap(page, file("04-korzina"));
      });
  } finally {
    await ctx.close();
  }
}

async function adminAfter(browser) {
  if (!AUTH || !isLocal(AUTH)) return log("skip after 05-adminka: нет --auth-base на 127.0.0.1 (на превью Vercel не входим)");
  const staff = await createUser("admin-ba", ["admin"], "Администратор Проверки");
  const ctx = await newContext(browser, "desktop", AUTH);
  const page = await ctx.newPage();
  try {
    await step("after 05-adminka-desktop", async () => {
      await loginContext(ctx, AUTH, staff);
      await page.goto(AUTH + "/admin", { waitUntil: "load", timeout: 90_000 });
      await settle(page, 1200);
      await snap(page, path.join(OUT, "after", "05-adminka-desktop.png"));
    });
  } finally {
    await ctx.close();
  }
}

// Склейка пары в браузере: подписи «Было» / «Стало», шрифт системный
async function makePair(browser, view, title, device, beforeFile, afterFile, beforeNote) {
  const phone = device === "phone";
  const cardW = phone ? 390 : 740;
  const ratio = phone ? 844 / 390 : 900 / 1440;
  const width = phone ? 40 + cardW * 2 + 72 + 40 : 40 + cardW * 2 + 48 + 40;
  const img = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0}
    body{background:#f7f1ea;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif;color:#2b2b2b;padding:28px 40px 40px;width:${width}px}
    h1{font-size:${phone ? 26 : 30}px;font-weight:700;margin-bottom:18px;letter-spacing:.2px}
    .row{display:flex;gap:${phone ? 72 : 48}px;align-items:flex-start}
    .col{width:${cardW}px}
    .tag{display:inline-block;font-size:${phone ? 17 : 19}px;font-weight:700;padding:6px 14px;border-radius:999px;margin-bottom:10px}
    .was{background:#e9e4de;color:#5b5b5b}.now{background:#c0392b;color:#fff}
    .note{font-size:${phone ? 13 : 14}px;color:#6b6b6b;margin:0 0 10px 4px;display:inline-block}
    .shot{width:${cardW}px;height:${Math.round(cardW * ratio)}px;border-radius:${phone ? 22 : 12}px;overflow:hidden;box-shadow:0 8px 28px rgba(60,30,10,.18);background:#fff;border:1px solid rgba(0,0,0,.08)}
    .shot img{width:100%;height:100%;object-fit:cover;object-position:top;display:block}
  </style></head><body>
    <h1>${title} · ${phone ? "телефон" : "компьютер"}</h1>
    <div class="row">
      <div class="col"><span class="tag was">Было</span> <span class="note">${beforeNote}</span><div class="shot"><img src="${img(beforeFile)}"></div></div>
      <div class="col"><span class="tag now">Стало</span> <span class="note">новая версия, осень</span><div class="shot"><img src="${img(afterFile)}"></div></div>
    </div></body></html>`;
  const ctx = await browser.newContext({ viewport: { width, height: 400 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT, `${view}-${device}.png`), fullPage: true });
  await ctx.close();
}

log(`present-before-after: before=${BEFORE} after=${BASE} auth-base=${AUTH || "—"} out=${OUT} · ${stamp()}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--lang=ru-RU"] });
try {
  for (const device of DEVICES) {
    if (ONLY.has("before")) await shootSite(browser, "before", BEFORE, device);
    if (ONLY.has("after")) await shootSite(browser, "after", BASE, device);
  }
  if (ONLY.has("after") && DEVICES.includes("desktop")) await adminAfter(browser);
  if (ADMIN_BEFORE && DEVICES.includes("desktop")) fs.copyFileSync(ADMIN_BEFORE, path.join(OUT, "before", "05-adminka-desktop.png"));
  else log("skip before 05-adminka: нет снимка админки «было» (--admin-before)");
  if (ONLY.has("pairs")) {
    for (const device of DEVICES)
      for (const [view, title] of VIEWS) {
        const b = path.join(OUT, "before", `${view}-${device}.png`);
        const a = path.join(OUT, "after", `${view}-${device}.png`);
        if (!fs.existsSync(b) || !fs.existsSync(a)) {
          log(`skip пара ${view}-${device}: нет ${!fs.existsSync(b) ? "«было»" : "«стало»"}`);
          continue;
        }
        const note = view === "05-adminka" ? "дневная версия, 12.11" : "основной сайт до ночи 2";
        await step(`пара ${view}-${device}`, () => makePair(browser, view, title, device, b, a, note));
      }
  }
} finally {
  await browser.close();
  await cleanupUsers(log);
}
const bad = results.filter((r) => !r.ok);
log(`ИТОГ: шагов ok ${results.length - bad.length}, не получилось ${bad.length}${bad.length ? ": " + bad.map((r) => r.name).join(", ") : ""}; пар: ${fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length}`);
log(`время прогона: ${log.elapsed()} с`);
