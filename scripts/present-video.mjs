// Презентация (ночь 2): видео ≈ 1 минута нового пути клиента — главная «Осень» → каталог → продукт → редактор
// (тестовая галерея, ИИ-команда «как в старом кино», поиск словом «размой собаку») → проверка → корзина с OSEN2026 →
// оформление → «Заказ оформлен» с открыткой → «Мои заказы». Телефон 390×844 (или --device desktop 1440×900).
//
// Запуск из папки проекта (свой сервер уже запущен, вход — только на 127.0.0.1):
//   npm run present:video -- --base http://127.0.0.1:3000 --out ../docs/presentation/final/demo-video-v2.webm
// Параметры: --device phone|desktop · --target 70 (длина ролика, с; длинные места ускоряются) · --captions off
//
// Как пишется: встроенная запись Playwright (recordVideo) требует ffmpeg, а он не ставится на macOS 13. Поэтому кадры
// берём через CDP (Page.startScreencast), а webm собирает сам Chrome: canvas → captureStream → MediaRecorder (VP8).
// Ожидания (загрузка фото, модели ИИ, оформление) ускоряются, паузы для чтения сохраняются (не длиннее 4 с).
// В файл дописывается длительность (у webm из MediaRecorder её нет — без неё плееры не показывают длину ролика).
// Клиент — тестовый night2-mat-v-…@example.com, удаляется после записи вместе с заказом, файлами и личным промокодом.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import { alignAnswer, applyPromo, cleanupUsers, createUser, ensureAutumn, isLocal, loginContext, makeLog, newContext, parseArgs, stamp, trimBase } from "./present-common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://127.0.0.1:3000", out: ".night-logs/present-video/demo-video-v2.webm", device: "phone", target: "70", fps: "15", captions: "on" });
const BASE = trimBase(args.base);
if (!isLocal(BASE)) throw new Error("--base: видео пишется со входом — только свой сервер 127.0.0.1 / localhost");
const OUT = path.resolve(args.out);
const DEVICE = args.device === "desktop" ? "desktop" : "phone";
const TARGET = Number(args.target) || 70;
const FPS = Number(args.fps) || 15;
const CAPTIONS = args.captions !== "off";
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const log = makeLog(OUT.replace(/\.webm$/, "") + "-log.txt");

const PHOTOS = ["autumn-forest", "mir-castle", "dog", "cat", "flowers", "nesvizh", "braslav-lake", "sunset-sun"].map((f) => f + ".jpg");
const PROMO = "OSEN2026";
const SIZE = DEVICE === "phone" ? { width: 390, height: 844, dpr: 2 } : { width: 1440, height: 900, dpr: 1 };
const W = SIZE.width * SIZE.dpr;
const H = SIZE.height * SIZE.dpr;

const frames = []; // { t (с), buf }
const fast = []; // { from, to, speed } — ускоренные ожидания
const now = () => Date.now() / 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, timeout = 30_000, every = 300) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(every);
  }
  throw new Error(`не дождались за ${Math.round(timeout / 1000)} с`);
}
async function ff(fn, speed = 8) {
  const from = now();
  try {
    return await fn();
  } finally {
    fast.push({ from, to: now(), speed });
  }
}

// Подписи и «касания» поверх страницы — попадают в кадры
const OVERLAY = () => {
  const ensure = () => {
    let el = document.getElementById("__cap");
    if (!el && document.body) {
      el = document.createElement("div");
      el.id = "__cap";
      el.setAttribute("aria-hidden", "true");
      el.style.cssText =
        "position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;" +
        "max-width:92vw;padding:9px 16px;border-radius:999px;background:rgba(40,24,18,.88);color:#fff;font:600 15px/1.3 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;" +
        "text-align:center;box-shadow:0 6px 18px rgba(0,0,0,.25);opacity:0;transition:opacity .35s";
      document.body.appendChild(el);
    }
    return el;
  };
  // над нижним меню и нижней панелью с ценой (если они есть)
  const place = (el) => {
    let top = innerHeight;
    for (const n of document.querySelectorAll(".sticky-bar, nav, [class*='tabbar'], [class*='bottom']")) {
      const r = n.getBoundingClientRect();
      const pos = getComputedStyle(n).position;
      if ((pos === "fixed" || pos === "sticky") && r.height > 0 && r.top > innerHeight / 2 && r.top < innerHeight) top = Math.min(top, r.top);
    }
    el.style.bottom = innerHeight - top + 10 + "px";
  };
  window.__cap = (text) => {
    const el = ensure();
    if (!el) return;
    if (!text) return void (el.style.opacity = "0");
    el.textContent = text;
    place(el);
    el.style.opacity = "1";
  };
  addEventListener("scroll", () => {
    const el = document.getElementById("__cap");
    if (el) place(el);
  }, { passive: true });
  window.addEventListener(
    "pointerdown",
    (e) => {
      const d = document.createElement("div");
      d.style.cssText = `position:fixed;left:${e.clientX - 22}px;top:${e.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(192,57,43,.35);border:2px solid rgba(192,57,43,.8);z-index:2147483647;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
      document.body.appendChild(d);
      requestAnimationFrame(() => ((d.style.transform = "scale(1.6)"), (d.style.opacity = "0")));
      setTimeout(() => d.remove(), 600);
    },
    true,
  );
};

log(`present-video: base=${BASE} device=${DEVICE} out=${OUT} · ${stamp()}`);
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--lang=ru-RU"] });
let ok = false;
try {
  const user = await createUser("video", ["client"], "Анна Иванова");
  const ctx = await newContext(browser, DEVICE, BASE, { deviceScaleFactor: SIZE.dpr });
  await ctx.addInitScript(OVERLAY);
  await loginContext(ctx, BASE, user);

  // Прогрев: модели ИИ в кэш этого контекста (без записи), чтобы в ролике не ждать загрузку
  await ff(async () => {
    const warm = await ctx.newPage();
    try {
      await warm.goto(BASE + "/product/photo", { waitUntil: "load", timeout: 90_000 });
      await warm.getByRole("button", { name: "Выбрать фото" }).click();
      await warm.waitForURL(/\/editor/, { timeout: 60_000 });
      await warm.getByRole("button", { name: "Тестовая галерея" }).click();
      const g = warm.getByRole("region", { name: "Тестовая галерея" });
      await g.locator("input[type=checkbox]").first().waitFor({ timeout: 60_000 });
      await g.getByRole("button", { name: "Снять выбор" }).click();
      await g.locator('label[data-file="dog.jpg"] input[type=checkbox]').check();
      await g.getByRole("button", { name: "Добавить 1 фото" }).click();
      await warm.locator(".photo-cell img").first().waitFor({ timeout: 120_000 });
      await warm.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Правки", exact: true }).click();
      await warm.locator(".pe-after[data-rendered]").waitFor({ timeout: 60_000 });
      const pre = warm.locator("[data-ai-prefetch]");
      if ((await pre.count()) && (await pre.getAttribute("data-ai-prefetch")) !== "ready") {
        const btn = pre.getByRole("button", { name: /Скачать ИИ заранее/ });
        if (await btn.count()) {
          await btn.click();
          await poll(async () => (await pre.getAttribute("data-ai-prefetch")) === "ready", 300_000, 1000).catch(() => log("прогрев: «Скачать ИИ заранее» не дошёл до ready"));
        }
      }
      const cmd = warm.locator("#pe-cmd");
      await cmd.fill("размой собаку");
      await cmd.press("Enter");
      await poll(async () => /Нашёл собаку/.test(await warm.locator(".pe-answer").innerText()), 240_000, 500);
      log("прогрев ИИ: готово");
    } catch (e) {
      log("прогрев ИИ не удался (ролик будет с ожиданием): " + e.message.split("\n")[0]);
    } finally {
      // проект прогрева убираем с устройства, чтобы он не попал в «Мои книги» ролика
      await warm.evaluate(() => new Promise((res) => {
        const r = indexedDB.deleteDatabase("picpac");
        r.onsuccess = r.onerror = r.onblocked = () => res();
      })).catch(() => {});
      await warm.close();
    }
  });
  // Сервер: проект прогрева (если ушёл в аккаунт) — удалить
  await ctx.request.get(BASE + "/api/v1/projects").then(async (r) => {
    const j = await r.json().catch(() => null);
    for (const p of j?.items || j?.projects || []) await ctx.request.delete(`${BASE}/api/v1/projects/${p.id}`).catch(() => {});
  }).catch(() => {});

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  const cdp = await ctx.newCDPSession(page);
  cdp.on("Page.screencastFrame", (f) => {
    const t = now();
    const buf = Buffer.from(f.data, "base64");
    const last = frames[frames.length - 1];
    if (last && t - last.t < 1 / FPS) last.buf = buf; // чаще FPS — заменяем последний кадр (конечное состояние не теряется)
    else frames.push({ t, buf });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

  const hold = (ms) => page.waitForTimeout(ms);
  const cap = async (text) => {
    if (CAPTIONS) await page.evaluate((t) => window.__cap?.(t), text).catch(() => {});
  };
  const smooth = async (y, wait = 1100) => {
    await page.evaluate((top) => window.scrollTo({ top, behavior: "smooth" }), y);
    await hold(wait);
  };
  const yOf = (loc, off) => loc.first().evaluate((n, o) => n.getBoundingClientRect().top + window.scrollY - o, off);
  const nav = () => page.getByRole("navigation", { name: "Шаги редактора" });
  const say = async (text, delay = 55) => {
    const cmd = page.locator("#pe-cmd");
    await cmd.click();
    await cmd.fill("");
    await cmd.pressSequentially(text, { delay });
    await hold(350);
    await cmd.press("Enter");
  };
  const top = DEVICE === "phone" ? 64 : 80;

  // 1. Главная «Осень»
  await ensureAutumn(null, BASE, log);
  await page.goto(BASE + "/", { waitUntil: "load", timeout: 90_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await hold(600);
  const startT = now();
  await cap("PicPac осенью: главная");
  await hold(2600);
  if (await page.getByTestId("season-banner").count()) {
    await smooth(await yOf(page.getByTestId("season-banner"), top));
    await cap("Сезон «Осень» включает администратор");
    await hold(1800);
  }
  // 2. Каталог
  await smooth(await yOf(page.locator("#catalog"), top));
  await cap("Каталог: цена видна сразу");
  await hold(1700);
  // 3. Продукт
  await page.locator('a[href="/product/layflat"]').first().click();
  await page.waitForURL(/\/product\/layflat/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await cap("Фотокнига Classic — цена и сроки");
  await hold(2200);
  // 4. Редактор: тестовая галерея
  await page.getByRole("button", { name: "Создать фотокнигу" }).click();
  await page.waitForURL(/\/editor/, { timeout: 60_000 });
  await cap("Добавляем фото из галереи");
  await hold(900);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await gallery.locator("input[type=checkbox]").first().waitFor({ timeout: 60_000 });
  await gallery.scrollIntoViewIfNeeded();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  await hold(400);
  for (const f of PHOTOS) {
    await gallery.locator(`label[data-file="${f}"] input[type=checkbox]`).check();
    await hold(140);
  }
  await hold(500);
  await gallery.getByRole("button", { name: `Добавить ${PHOTOS.length} фото` }).click();
  await ff(() => poll(async () => (await page.locator(".photo-cell img").count()) >= PHOTOS.length, 180_000), 6);
  await smooth(await yOf(page.getByText(/^Фото: \d+$/), top + 8), 900);
  await cap(`${PHOTOS.length} фото в проекте`);
  await hold(1600);
  // 5. Правки: ИИ на устройстве
  await nav().getByRole("button", { name: "Правки", exact: true }).click();
  await page.locator('[data-edit-photo="dog.jpg"]').click({ timeout: 30_000 });
  await page.locator(".pe-after[data-rendered]").waitFor({ timeout: 60_000 });
  await smooth(await yOf(page.locator("[data-local-ai]"), top + 8), 700);
  await cap("ИИ работает на телефоне — фото никуда не уходят");
  await hold(2400);
  await cap("Команда словами: «как в старом кино»");
  await alignAnswer(page, 64);
  await say("как в старом кино");
  await poll(async () => /старом кино/i.test(await page.locator(".pe-answer").innerText()), 60_000);
  await alignAnswer(page, 64);
  await hold(2600);
  await say("верни цвет", 30);
  await hold(900);
  await cap("Поиск предмета словом: «размой собаку»");
  await say("размой собаку");
  await ff(() => poll(async () => /Нашёл собаку и размыл/i.test(await page.locator(".pe-answer").innerText()), 240_000, 250), 14);
  const done = page.locator(".pe-select").getByRole("button", { name: "Готово", exact: true });
  if (await done.isVisible().catch(() => false)) await done.click();
  await alignAnswer(page, 64);
  await hold(2800);
  // 6. Проверка → корзина
  await nav().getByRole("button", { name: "Проверка" }).click();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await cap("Проверка перед заказом: подскажет, что поправить");
  await hold(2400);
  const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
  for (let i = 0; i < 8 && (await toCart.isDisabled()); i++) {
    const all = page.getByRole("button", { name: /^Продолжить всё равно для всех/ }).first();
    const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
    if (await all.isVisible().catch(() => false)) await all.click();
    else if (await go.isVisible().catch(() => false)) await go.click();
    await hold(500);
  }
  await toCart.scrollIntoViewIfNeeded();
  await hold(600);
  await toCart.click();
  await page.waitForURL(/\/cart/, { timeout: 60_000 });
  await page.getByText("Фотокнига Classic").first().waitFor({ timeout: 60_000 });
  await cap("Корзина");
  await hold(1500);
  // 7. Промокод OSEN2026, получатель, доставка
  const promo = page.getByRole("textbox", { name: "Промокод" });
  await smooth(await yOf(page.locator("#h-promo"), top + 8), 800);
  await cap(`Осенний промокод ${PROMO}`);
  await promo.click();
  if (!(await applyPromo(page, PROMO, BASE, log, { typeDelay: 80 }))) log(`ВНИМАНИЕ: ${PROMO} не применился — в ролике без скидки`);
  await hold(2200);
  await smooth(await yOf(page.getByLabel("Имя и фамилия"), top + 60), 700);
  await cap("Получатель и доставка");
  await page.getByLabel("Имя и фамилия").pressSequentially("Анна Иванова", { delay: 35 });
  await page.getByLabel("Телефон").pressSequentially("291234567", { delay: 35 });
  await page.locator('input[name="delivery"]').first().check();
  await page.locator("#f-pickup_point").selectOption({ index: 1 });
  await hold(900);
  await smooth(await yOf(page.locator("#h-total"), top + 8), 800);
  await cap("Тестовая оплата — деньги не списываются");
  await hold(2000);
  // 8. Оформление → открытка
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await ff(() => page.getByRole("heading", { name: "Заказ оформлен" }).waitFor({ timeout: 180_000 }), 6);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await cap("Заказ оформлен!");
  await hold(1800);
  const pc = page.getByTestId("postcard");
  await pc.waitFor({ timeout: 60_000 });
  await smooth(await yOf(pc, top + 8), 900);
  await cap("Открытка с личным промокодом на следующий заказ");
  await hold(3200);
  // 9. Мои заказы
  await page.goto(BASE + "/orders", { waitUntil: "load", timeout: 90_000 });
  await ff(() => page.locator("a[data-number]").first().waitFor({ timeout: 60_000 }).catch(() => {}), 6);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await hold(300);
  await cap("«Мои заказы»: статус и код открытки");
  await hold(3200);
  const endT = now();

  await cdp.send("Page.stopScreencast").catch(() => {});
  // кадры до загруженной главной не нужны (белый экран): начинаем с последнего кадра до startT
  const first = Math.max(0, frames.findLastIndex((f) => f.t <= startT));
  frames.splice(0, first);
  if (errors.length) log("ошибки страницы: " + [...new Set(errors)].join(" | "));
  await ctx.close();

  // ---------- сборка ролика ----------
  const MAXGAP = 4;
  const speedAt = (t) => fast.find((m) => t >= m.from && t < m.to)?.speed || 1;
  let durs = frames.map((f, k) => Math.min(MAXGAP, ((k + 1 < frames.length ? frames[k + 1].t : endT) - f.t) / speedAt(f.t)));
  const raw = durs.reduce((a, b) => a + b, 0);
  const speed = Math.max(1, raw / TARGET);
  durs = durs.map((d) => (d / speed) * 1000);
  // Прореживание: каждый кадр на экране не меньше 1/12 с — иначе кодировщик не успевает (ускоренные ожидания дают
  // сотни кадров по несколько миллисекунд, он отстаёт и «съедает» следующие шаги). Склеенный кадр берёт последнюю картинку.
  const MIN_MS = 1000 / 12;
  const kept = [];
  for (let i = 0; i < frames.length; i++) {
    const last = kept[kept.length - 1];
    if (last && last.d < MIN_MS) {
      last.d += durs[i];
      last.i = i;
    } else kept.push({ i, d: durs[i] });
  }
  const order = kept.map((k) => k.i);
  durs = kept.map((k) => k.d);
  const total = durs.reduce((a, b) => a + b, 0);
  log(`кадров ${frames.length} → ${kept.length} после прореживания, после сжатия ожиданий ${raw.toFixed(1)} с, общее ускорение ×${speed.toFixed(2)} → ролик ${(total / 1000).toFixed(1)} с`);

  const enc = await browser.newContext({ viewport: { width: 320, height: 240 } });
  const rp = await enc.newPage();
  await rp.route("https://rec.invalid/**", async (route) => {
    const u = new URL(route.request().url());
    const m = u.pathname.match(/^\/f\/(\d+)$/);
    if (m) return route.fulfill({ contentType: "image/jpeg", body: frames[order[Number(m[1])]].buf });
    return route.fulfill({ contentType: "text/html", body: "<!doctype html><meta charset=utf-8><body style=margin:0></body>" });
  });
  await rp.goto("https://rec.invalid/");
  const b64 = await rp.evaluate(
    async ({ n, durs, w, h }) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      document.body.appendChild(c);
      const g = c.getContext("2d");
      const load = async (i) => createImageBitmap(await (await fetch(`/f/${i}`)).blob());
      const bmp0 = await load(0);
      g.drawImage(bmp0, 0, 0, w, h);
      const mr = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: w * h * 3 });
      const chunks = [];
      mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mr.start(1000);
      const t0 = performance.now();
      let acc = 0;
      let next = n > 1 ? load(1) : null;
      let cur = bmp0;
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          cur?.close();
          cur = await next;
          g.drawImage(cur, 0, 0, w, h);
          next = i + 1 < n ? load(i + 1) : null;
        }
        acc += durs[i];
        for (let left = t0 + acc - performance.now(); left > 0; left = t0 + acc - performance.now()) {
          await new Promise((r) => setTimeout(r, Math.min(100, left)));
          if (cur) g.drawImage(cur, 0, 0, w, h);
        }
      }
      cur?.close();
      mr.stop();
      await new Promise((r) => (mr.onstop = r));
      const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    },
    { n: order.length, durs, w: W, h: H },
  );
  await enc.close();
  const webm = withDuration(Buffer.from(b64, "base64"), total);
  fs.writeFileSync(OUT, webm);
  log(`видео: ${OUT} · ${(webm.length / 1048576).toFixed(1)} МБ · ${(total / 1000).toFixed(1)} с · ${W}×${H}`);
  ok = true;
} catch (e) {
  log("FAIL видео: " + e.message.split("\n").slice(0, 3).join(" "));
} finally {
  await browser.close();
  await cleanupUsers(log);
  log(`время прогона: ${log.elapsed()} с`);
  process.exitCode = ok ? 0 : 1;
}

// ---------- длительность в webm (Segment → Info → Duration) ----------
function vint(buf, pos) {
  const b = buf[pos];
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(b & mask)) {
    len++;
    mask >>= 1;
  }
  let value = b & (mask - 1);
  for (let i = 1; i < len; i++) value = value * 256 + buf[pos + i];
  return { len, value, unknown: value === 2 ** (7 * len) - 1 };
}
function readId(buf, pos) {
  const { len } = vint(buf, pos);
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}
function sizeBytes(value, len) {
  const out = Buffer.alloc(len);
  let v = value;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 0x80 >> (len - 1);
  return out;
}
function withDuration(buf, ms) {
  try {
    let pos = 0;
    const ebml = readId(buf, pos);
    const ebmlSize = vint(buf, pos + ebml.len);
    pos += ebml.len + ebmlSize.len + ebmlSize.value;
    const seg = readId(buf, pos);
    if (seg.id !== 0x18538067) return buf;
    const segSize = vint(buf, pos + seg.len);
    let p = pos + seg.len + segSize.len;
    while (p < buf.length) {
      const el = readId(buf, p);
      const sz = vint(buf, p + el.len);
      const dataStart = p + el.len + sz.len;
      if (el.id === 0x1549a966) {
        const info = buf.subarray(dataStart, dataStart + sz.value);
        // уже есть Duration — перезаписать
        let q = 0;
        while (q < info.length) {
          const c = readId(info, q);
          const cs = vint(info, q + c.len);
          if (c.id === 0x4489 && cs.value === 8) {
            info.writeDoubleBE(ms, q + c.len + cs.len);
            return buf;
          }
          q += c.len + cs.len + cs.value;
        }
        const dur = Buffer.alloc(11);
        dur[0] = 0x44;
        dur[1] = 0x89;
        dur[2] = 0x88;
        dur.writeDoubleBE(ms, 3);
        const newSize = sz.value + dur.length;
        const len = newSize < 2 ** (7 * sz.len) - 1 ? sz.len : 8;
        return Buffer.concat([buf.subarray(0, p + el.len), sizeBytes(newSize, len), info, dur, buf.subarray(dataStart + sz.value)]);
      }
      if (sz.unknown) break;
      p = dataStart + sz.value;
    }
  } catch {}
  return buf;
}
