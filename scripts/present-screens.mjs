// Презентация (ночь 2): снимки экранов новой версии — компьютер 1440×900 @2x и телефон 390×844 @3x (мобильная эмуляция
// Chromium), светлая тема, сезон «Осень», онбординг пропущен. Экраны — по разделу «Утро» плана ночи 2.
//
// Запуск из папки проекта (сервер уже запущен):
//   npm run present:screens -- --base http://127.0.0.1:3000 --out ../docs/presentation/final/screens
// Параметры:
//   --base       адрес для открытых экранов (главная, каталог, продукт, редактор гостем, помощь)
//   --auth-base  адрес для экранов со входом (корзина, открытка, заказ, поддержка, админка). Только 127.0.0.1 / localhost;
//                по умолчанию — --base, если он локальный. Иначе экраны со входом пропускаются (на превью Vercel не входим).
//   --out        папка для снимков (имена: 01-glavnaya-desktop.png …); журнал — _log.txt там же
//   --devices    desktop,phone (по умолчанию оба)    --only open,editor,order,admin (по умолчанию все)
// Тестовые пользователи night2-mat-…@example.com создаются сервисным ключом из .env.local и удаляются в конце
// вместе с заказами, файлами и личными промокодами. Демо-аккаунты не используются. Скрипт не падает из-за одного экрана:
// неудачный экран — строка FAIL в журнале, остальные снимаются.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { chromium, request as pwRequest } from "@playwright/test";
import {
  adminClient,
  checkSeason,
  cleanupUsers,
  createUser,
  isLocal,
  loginContext,
  alignAnswer,
  applyPromo,
  ensureAutumn,
  makeLog,
  newContext,
  parseArgs,
  scrollTop,
  scrollToEl,
  serverProjectInCart,
  settle,
  stamp,
  trimBase,
} from "./present-common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://127.0.0.1:3000", out: ".night-logs/present-screens", devices: "desktop,phone", only: "open,editor,order,admin" });
const BASE = trimBase(args.base);
const AUTH = trimBase(args["auth-base"] || (isLocal(BASE) ? BASE : ""));
const OUT = path.resolve(args.out);
const DEVICES = args.devices.split(",").map((s) => s.trim()).filter(Boolean);
const ONLY = new Set(args.only.split(",").map((s) => s.trim()));
fs.mkdirSync(OUT, { recursive: true });
const log = makeLog(path.join(OUT, "_log.txt"));

const GALLERY = ["mir-castle", "nesvizh", "braslav-lake", "bison", "dog", "cat", "autumn-forest", "flowers", "beach", "sunset-sun", "winter-field", "cake", "nesvizh-small"].map((f) => f + ".jpg");
const DOG = [0.64, 0.34]; // чёрная спина собаки на dog.jpg (как в e2e/editor-local-ai.spec.mjs)
const PROMO = "OSEN2026";

const results = [];
const pageErrors = [];

// ---------- мелкие помощники ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, timeout = 30_000, every = 400) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await fn();
      if (last) return last;
    } catch {}
    await sleep(every);
  }
  throw new Error(`не дождались за ${Math.round(timeout / 1000)} с`);
}
const waitCount = (loc, n, timeout = 60_000) => poll(async () => (await loc.count()) >= n, timeout);
const waitText = (loc, re, timeout = 60_000) => poll(async () => re.test(await loc.first().innerText({ timeout: 2000 })), timeout);

async function step(name, device, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, device, ok: true });
    log(`ok   ${name}-${device} (${((Date.now() - t0) / 1000).toFixed(1)} с)`);
    return true;
  } catch (e) {
    results.push({ name, device, ok: false, why: e.message.split("\n")[0] });
    log(`FAIL ${name}-${device}: ${e.message.split("\n")[0].slice(0, 220)}`);
    return false;
  }
}
function skip(name, device, why) {
  results.push({ name, device, ok: false, skipped: true, why });
  log(`skip ${name}-${device}: ${why}`);
}
async function snap(page, name, device, opts = {}) {
  // всплывающие уведомления не должны закрывать экран
  await page.waitForFunction(() => !document.querySelector(".toast, .toasts > *, [data-toast]"), null, { timeout: 6000 }).catch(() => {});
  const file = path.join(OUT, `${name}-${device}.png`);
  await page.screenshot({ path: file, ...opts });
  return file;
}
function watch(page, where) {
  page.on("pageerror", (e) => pageErrors.push(`${where}: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|favicon|ERR_ABORTED/i.test(m.text())) pageErrors.push(`${where} console: ${m.text().slice(0, 200)}`);
  });
}
const nav = (page) => page.getByRole("navigation", { name: "Шаги редактора" });
// Высокий снимок «фото + команда + ответ» целиком (часть страницы, без шапки)
async function tallClip(page, name, device) {
  const box = await page.evaluate(() => {
    const a = document.querySelector(".pe-answer")?.getBoundingClientRect();
    const ph = document.querySelector(".pe-after")?.getBoundingClientRect();
    if (!a || !ph) return null;
    return { top: ph.top + scrollY - 16, bottom: a.bottom + scrollY + 16 };
  });
  if (!box) return;
  const vw = page.viewportSize().width;
  await page.screenshot({ path: path.join(OUT, `${name}-${device}.png`), fullPage: true, clip: { x: 0, y: box.top, width: vw, height: box.bottom - box.top } });
}
// N11 (если влит): «посмотреть книгу целиком» — листаемое превью (кнопка на «Автомакете» или «Проверке»)
async function tryBookPreview(page, device) {
  const flip = page.getByRole("button", { name: /книг[ау] целиком|Листать книгу|Посмотреть книгу|Превью книги/i });
  if (!(await flip.count())) return false;
  try {
    await flip.first().click();
    await page.waitForTimeout(2500);
    await snap(page, "10b-prevyu-knigi-listat", device);
    log(`ok   10b-prevyu-knigi-listat-${device}`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(500);
    return true;
  } catch (e) {
    log(`FAIL 10b-prevyu-knigi-listat-${device}: ${e.message.split("\n")[0].slice(0, 160)}`);
    return false;
  }
}
async function say(page, text) {
  const cmd = page.locator("#pe-cmd");
  await cmd.fill(text);
  await cmd.press("Enter");
}

// ---------- 1. открытые экраны ----------
async function openScreens(browser, device) {
  const ctx = await newContext(browser, device, BASE);
  const page = await ctx.newPage();
  watch(page, `${device} open`);
  try {
    await step("01-glavnaya", device, async () => {
      await page.goto(BASE + "/", { waitUntil: "load", timeout: 90_000 });
      await ensureAutumn(page, BASE, log);
      await settle(page, 1200);
      await snap(page, "01-glavnaya", device);
    });
    await step("01b-glavnaya-osen", device, async () => {
      // осенний баннер сезона (после первого экрана)
      if (!(await page.getByTestId("season-banner").count())) await ensureAutumn(page, BASE, log);
      if (!(await page.getByTestId("season-banner").count())) throw new Error("нет баннера сезона (сезон не «Осень»?)");
      await scrollToEl(page, page.getByTestId("season-banner"), device === "phone" ? 64 : 72);
      await settle(page, 900);
      await snap(page, "01b-glavnaya-osen", device);
    });
    await step("02-katalog", device, async () => {
      await scrollToEl(page, "#catalog", device === "phone" ? 70 : 96);
      await settle(page, 900);
      await snap(page, "02-katalog", device);
    });
    await step("03-produkt", device, async () => {
      await page.goto(BASE + "/product/layflat", { waitUntil: "load", timeout: 90_000 });
      await settle(page, 900);
      await snap(page, "03-produkt", device);
    });
    await step("17-pomosch", device, async () => {
      await page.goto(BASE + "/help", { waitUntil: "load", timeout: 90_000 });
      await settle(page, 600);
      await snap(page, "17-pomosch", device);
    });
  } finally {
    await ctx.close();
  }
}

// ---------- 2. редактор (гость, на устройстве) ----------
async function editorScreens(browser, device) {
  const ctx = await newContext(browser, device, BASE);
  const page = await ctx.newPage();
  watch(page, `${device} editor`);
  const answer = page.locator(".pe-answer");
  let bookShot = false;
  try {
    const opened = await step("_redaktor-otkryt", device, async () => {
      await page.goto(BASE + "/product/layflat", { waitUntil: "load", timeout: 90_000 });
      await page.getByRole("button", { name: "Создать фотокнигу" }).click();
      await page.waitForURL(/\/editor/, { timeout: 60_000 });
      await page.getByRole("button", { name: "Тестовая галерея" }).click();
      const gallery = page.getByRole("region", { name: "Тестовая галерея" });
      await gallery.locator("input[type=checkbox]").first().waitFor({ timeout: 60_000 });
      await gallery.getByRole("button", { name: "Снять выбор" }).click();
      for (const f of GALLERY) await gallery.locator(`label[data-file="${f}"] input[type=checkbox]`).check();
      await gallery.getByRole("button", { name: `Добавить ${GALLERY.length} фото` }).click();
      await waitCount(page.locator(".photo-cell img"), GALLERY.length, 180_000);
    });
    if (!opened) return;

    await step("04-redaktor-foto", device, async () => {
      // сетка фото (над ней — плашка «Найдено дублей»: nesvizh-small повторяет nesvizh, это видно на «Проверке»)
      const grid = page.getByText(/^Фото: \d+$/).first();
      if (await grid.count()) await scrollToEl(page, grid, device === "phone" ? 70 : 96);
      else await scrollToEl(page, nav(page), device === "phone" ? 150 : 170);
      await settle(page, 1500);
      await snap(page, "04-redaktor-foto", device);
    });

    const edits = await step("05-redaktor-pravki", device, async () => {
      await nav(page).getByRole("button", { name: "Правки", exact: true }).click();
      await page.locator('[data-edit-photo="dog.jpg"]').click({ timeout: 30_000 });
      await page.locator(".pe-after[data-rendered]").waitFor({ timeout: 60_000 });
      await scrollToEl(page, nav(page), device === "phone" ? 70 : 90);
      await settle(page, 800);
      await snap(page, "05-redaktor-pravki", device);
    });
    if (!edits) return;

    await step("06-redaktor-ii-komanda", device, async () => {
      await say(page, "как в старом кино");
      await waitText(answer, /старом кино/i, 60_000);
      await page.waitForTimeout(800);
      await alignAnswer(page);
      await snap(page, "06-redaktor-ii-komanda", device);
      await tallClip(page, "06b-redaktor-ii-komanda-celikom", device);
      await say(page, "верни цвет");
      await page.waitForTimeout(1200);
    });

    await step("07-redaktor-kasanie", device, async () => {
      await page.getByRole("button", { name: "Выделить касанием" }).click();
      await page.locator('.pe-select[data-ready="true"]').waitFor({ timeout: 240_000 });
      const c = page.locator(".pe-after");
      await c.scrollIntoViewIfNeeded();
      const box = await c.boundingBox();
      await c.click({ position: { x: box.width * DOG[0], y: box.height * DOG[1] } });
      await page.getByText(/^Выделено\./).first().waitFor({ timeout: 90_000 });
      await page.waitForTimeout(700);
      await scrollToEl(page, ".pe-after", device === "phone" ? 70 : 90);
      await snap(page, "07-redaktor-kasanie", device);
      const close = page.locator(".pe-select").getByRole("button", { name: /^(Отмена|Готово)$/ });
      if (await close.count()) await close.first().click();
    });

    await step("08-redaktor-poisk-slovom", device, async () => {
      await say(page, "размой собаку");
      await waitText(answer, /Нашёл собаку и размыл/i, 240_000);
      await page.waitForTimeout(900);
      // панель выделения после поиска закрываем «Готово» — размытие уже применено, ответ остаётся
      const done = page.locator(".pe-select").getByRole("button", { name: "Готово", exact: true });
      if (await done.isVisible().catch(() => false)) {
        await done.click();
        await page.waitForTimeout(700);
      }
      await alignAnswer(page);
      await snap(page, "08-redaktor-poisk-slovom", device);
      await tallClip(page, "08b-redaktor-poisk-slovom-celikom", device);
    });

    await step("09-redaktor-foto-ne-uhodyat", device, async () => {
      const note = page.locator("[data-local-ai]");
      await note.waitFor({ timeout: 30_000 });
      await scrollToEl(page, note, device === "phone" ? 150 : 220);
      await snap(page, "09-redaktor-foto-ne-uhodyat", device);
      // крупно: плашка с отступами
      const b = await note.boundingBox();
      const pad = 16;
      const vw = page.viewportSize().width;
      await page.screenshot({ path: path.join(OUT, `09b-plashka-krupno-${device}.png`), clip: { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: Math.min(vw - Math.max(0, b.x - pad), b.width + pad * 2), height: b.height + pad * 2 } });
    });

    await step("10-prevyu-knigi", device, async () => {
      await nav(page).getByRole("button", { name: "Автомакет" }).click();
      await page.getByText(/Автомакет разложил фото по страницам/).first().waitFor({ timeout: 60_000 });
      await scrollToEl(page, nav(page), device === "phone" ? 70 : 90);
      await settle(page, 1200);
      await snap(page, "10-prevyu-knigi", device);
      bookShot = await tryBookPreview(page, device);
    });

    await step("11-proverka", device, async () => {
      await nav(page).getByRole("button", { name: "Проверка" }).click();
      await page.waitForTimeout(1500);
      await scrollToEl(page, nav(page), device === "phone" ? 70 : 90);
      await settle(page, 800);
      await snap(page, "11-proverka", device);
      if (!bookShot) bookShot = await tryBookPreview(page, device);
      if (!bookShot) log(`skip 10b-prevyu-knigi-listat-${device}: в сборке нет листаемого превью книги (N11)`);
    });
  } finally {
    await ctx.close();
  }
}

// ---------- 3. корзина → заказ → открытка → статусы → поддержка (тестовый клиент) ----------
async function orderScreens(browser, device) {
  const user = await createUser(device === "phone" ? "anna-tel" : "anna");
  const ctx = await newContext(browser, device, AUTH);
  const page = await ctx.newPage();
  watch(page, `${device} order`);
  try {
    const ready = await step("_korzina-podgotovka", device, async () => {
      await loginContext(ctx, AUTH, user);
      await serverProjectInCart(ctx, AUTH, { title: "Осень в Несвиже", files: ["autumn-forest.jpg", "nesvizh.jpg", "mir-castle.jpg"] });
    });
    if (!ready) return;

    const cartOk = await step("12-korzina-promokod", device, async () => {
      await page.goto(AUTH + "/cart", { waitUntil: "load", timeout: 90_000 });
      await page.getByText("Фотокнига Classic").first().waitFor({ timeout: 60_000 });
      await settle(page, 800);
      await snap(page, "12a-korzina", device);
      await ensureAutumn(page, AUTH, log);
      // промокод не применился (сезон так и не вернулся) — заказ и остальные экраны всё равно снимаем
      if (!(await applyPromo(page, PROMO, AUTH, log))) log(`FAIL 12-korzina-promokod-${device}: ${PROMO} не применился — дальше без промокода`);
      await page.getByLabel("Имя и фамилия").fill("Анна Иванова");
      await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
      await page.locator('input[name="delivery"]').first().check();
      await page.locator("#f-pickup_point").selectOption({ index: 1 });
      await scrollToEl(page, "#h-promo", device === "phone" ? 80 : 100);
      await page.waitForTimeout(500);
      await snap(page, "12-korzina-promokod", device);
      if (device === "phone" && (await page.locator("#h-total").count())) {
        // на телефоне «Итого» со скидкой — ниже, отдельным кадром
        await scrollToEl(page, "#h-total", 80);
        await page.waitForTimeout(400);
        await snap(page, "12b-korzina-itogo", device);
      }
    });
    if (!cartOk) return;

    let order = null;
    const placed = await step("13-otkrytka", device, async () => {
      await page.getByRole("button", { name: "Подтвердить заказ" }).click();
      await page.getByRole("heading", { name: "Заказ оформлен" }).waitFor({ timeout: 120_000 });
      const pc = page.getByTestId("postcard");
      await pc.waitFor({ timeout: 60_000 });
      await settle(page, 1500);
      await scrollTop(page);
      await snap(page, "13a-zakaz-oformlen", device);
      await scrollToEl(page, pc, device === "phone" ? 70 : 90);
      await page.waitForTimeout(600);
      await snap(page, "13-otkrytka", device);
      const list = await (await ctx.request.get(AUTH + "/api/v1/orders")).json();
      order = list?.items?.[0] || null;
    });
    if (!placed || !order?.id) return;

    await step("14-zakaz-statusy", device, async () => {
      // Симулятор производства (мок ERP): шаг 3 с для этого тестового заказа; ловим середину производства
      // («напечатано» / «переплёт» / «упаковано») и «замораживаем» (шаг 1 ч), чтобы снять заказ в работе
      await adminClient().from("orders").update({ sim_step_seconds: 3 }).eq("id", order.id);
      let status = "";
      let stage = "";
      await poll(async () => {
        const j = await (await ctx.request.get(`${AUTH}/api/v1/orders/${order.id}`)).json();
        status = j?.order?.status || "";
        stage = j?.order?.stage || "";
        return (status === "production" && ["printed", "bound", "packed"].includes(stage)) || status === "shipped" || status === "done";
      }, 90_000, 700).catch(() => {});
      await adminClient().from("orders").update({ sim_step_seconds: 3600 }).eq("id", order.id);
      log(`     заказ ${order.number}: статус ${status}${stage ? " · " + stage : ""}`);
      await page.goto(`${AUTH}/orders/${order.id}`, { waitUntil: "load", timeout: 90_000 });
      await page.getByTestId("order-number").waitFor({ timeout: 60_000 });
      await settle(page, 900);
      await snap(page, "14a-zakaz", device);
      const list = page.getByRole("list", { name: "Статус заказа" });
      if (await list.count()) {
        await scrollToEl(page, list, device === "phone" ? 130 : 160);
        await page.waitForTimeout(400);
      }
      await snap(page, "14-zakaz-statusy", device);
    });

    await step("15-podderzhka", device, async () => {
      await page.getByRole("button", { name: "Написать в поддержку" }).click();
      await page.getByLabel("Сообщение").fill("Здравствуйте! Подскажите, когда привезут заказ?");
      await page.getByRole("button", { name: "Отправить" }).click();
      const it = page.getByTestId("interaction");
      await it.first().waitFor({ timeout: 60_000 });
      const show = it.getByRole("button", { name: "Показать переписку" });
      if (await show.count()) await show.first().click();
      await waitText(it, /получено/i, 60_000).catch(() => {});
      await page.waitForTimeout(800);
      await scrollToEl(page, it, device === "phone" ? 80 : 120);
      await snap(page, "15-podderzhka", device);
    });

    await step("16-moi-zakazy", device, async () => {
      await page.goto(AUTH + "/orders", { waitUntil: "load", timeout: 90_000 });
      await page.locator(`a[data-number="${order.number}"]`).first().waitFor({ timeout: 60_000 });
      await settle(page, 900);
      await snap(page, "16-moi-zakazy", device);
    });
  } finally {
    await ctx.close();
  }
}

// ---------- 4. админка (тестовый администратор) ----------
// Заказ на модерации с фото, которое находит проверка на сервере (как в e2e/moderation.spec.mjs): клиент присылает
// поддельные «чистые» оценки, сервер всё равно находит символику. Фото у модератора размыто до «Показать».
async function flagJpeg(w = 900, h = 600) {
  const r = h * 0.3;
  const a = r * 0.62;
  const t = r * 0.2;
  const arm = `M ${-t / 2} ${-a} h ${t} v ${a - t / 2} h ${a - t / 2} v ${t} h ${-(a + t / 2)} Z M ${-t / 2} ${-a} h ${a} v ${t} h ${-a} Z`;
  const arms = [0, 90, 180, 270].map((d) => `<path d="${arm}" transform="rotate(${d})" fill="#000"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#d00"/><circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="#fff"/><g transform="translate(${w / 2} ${h / 2}) rotate(45)">${arms}</g></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function moderationFixture() {
  const user = await createUser("moderacia", ["client"], "Мария Тестова");
  const api = await pwRequest.newContext({ baseURL: AUTH });
  try {
    const r = await api.post("/api/v1/auth/login", { data: { email: user.email, password: user.password } });
    if (r.status() !== 200) throw new Error("вход клиента модерации: " + r.status());
    const fake = { v: 2, nsfw: 0.05, breast: 0, nude: 0, sex: 0, nazi: 0, weapon: 0, blood: 0, drugs: 0, art: 0 };
    const { projectId } = await serverProjectInCart({ request: api }, AUTH, { title: "Поездка", files: ["mir-castle.jpg"], extraPhotos: [{ buffer: await flagJpeg(), nsfw: fake }] });
    // ждём, пока проверка на сервере поставит флаг
    await poll(async () => {
      const { data } = await adminClient().from("project_photos").select("moderation_flag").eq("project_id", projectId);
      return (data || []).some((x) => x.moderation_flag);
    }, 90_000, 2000);
    const o = await api.post("/api/v1/orders", {
      headers: { "idempotency-key": `night2-mat-${Date.now()}` },
      data: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 7" } }, recipient: { name: "Мария Тестова", phone: "+375 29 765-43-21" } },
    });
    const oj = await o.json();
    if (o.status() !== 201) throw new Error("заказ для модерации: " + o.status() + " " + JSON.stringify(oj).slice(0, 160));
    await api.post(`/api/v1/orders/${oj.order.id}/pay-test`, { data: { method: "card_test" } });
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    await adminClient().from("orders").update({ status_changed_at: past, paid_at: past }).eq("id", oj.order.id);
    const st = (await (await api.get(`/api/v1/orders/${oj.order.id}`)).json())?.order?.status;
    log(`     заказ на модерации ${oj.order.number}: статус ${st}`);
    return oj.order.number;
  } finally {
    await api.dispose();
  }
}

async function adminScreens(browser, device, staff, modNumber) {
  const ctx = await newContext(browser, device, AUTH);
  const page = await ctx.newPage();
  watch(page, `${device} admin`);
  const go = async (p) => {
    await page.goto(AUTH + p, { waitUntil: "load", timeout: 90_000 });
    await settle(page, 900);
  };
  try {
    if (!(await step("_admin-vhod", device, () => loginContext(ctx, AUTH, staff)))) return;
    await step("20-admin-obzor", device, async () => {
      await go("/admin");
      await snap(page, "20-admin-obzor", device);
    });
    await step("21-admin-zakazy-filtry", device, async () => {
      await go("/admin/orders?status=production&sort=eta");
      await snap(page, "21-admin-zakazy-filtry", device);
    });
    await step("22-admin-promokody", device, async () => {
      await go("/admin/promo");
      // фильтр «Действуют»: выключенные и тестовые коды (остатки проверок) на слайд не попадают
      const active = page.getByRole("button", { name: "Действуют", exact: true });
      if (await active.count()) {
        await active.first().click();
        await page.waitForTimeout(600);
      }
      await snap(page, "22-admin-promokody", device);
    });
    await step("23-admin-sezon", device, async () => {
      await go("/admin/season");
      await snap(page, "23-admin-sezon", device);
    });
    await step("24-admin-moderatsiya", device, async () => {
      await go("/admin/moderation");
      const card = modNumber ? page.getByTestId("moderation-item").filter({ hasText: modNumber }) : page.getByTestId("moderation-item");
      if (await card.count()) {
        await card.first().getByTestId("moderation-findings").waitFor({ timeout: 30_000 });
        await page.waitForTimeout(1200);
        const first = (await page.getByTestId("moderation-item").first().textContent()) === (await card.first().textContent());
        // счётчики очереди + карточка с выводом модели словами и размытым фото
        if (first && (await page.getByTestId("moderation-stats").count())) await scrollToEl(page, page.getByTestId("moderation-stats"), device === "phone" ? 70 : 96);
        else await scrollToEl(page, card, device === "phone" ? 80 : 120);
      } else log(`     в очереди модерации нет карточек${modNumber ? " с заказом " + modNumber : ""}`);
      await snap(page, "24-admin-moderatsiya", device);
    });
    await step("25-admin-statistika", device, async () => {
      await go("/admin/stats");
      await page.waitForTimeout(800);
      await snap(page, "25-admin-statistika", device);
    });
    await step("26-admin-zhurnal", device, async () => {
      await go("/admin/audit");
      await snap(page, "26-admin-zhurnal", device);
    });
  } finally {
    await ctx.close();
  }
}

// ---------- прогон ----------
log(`present-screens: base=${BASE} auth-base=${AUTH || "—"} out=${OUT} devices=${DEVICES.join(",")} only=${[...ONLY].join(",")} · ${stamp()}`);
await checkSeason(BASE, log);
if (AUTH && !isLocal(AUTH)) throw new Error("--auth-base: вход только на своём сервере 127.0.0.1 / localhost");
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--lang=ru-RU"] });
try {
  for (const device of DEVICES) {
    if (ONLY.has("open")) await openScreens(browser, device);
    if (ONLY.has("editor")) await editorScreens(browser, device);
    if (ONLY.has("order")) {
      if (AUTH) await orderScreens(browser, device).catch((e) => log(`FAIL заказ ${device}: ${e.message}`));
      else skip("12…16 корзина/заказ", device, "нет --auth-base на 127.0.0.1 (на превью Vercel не входим)");
    }
  }
  if (ONLY.has("admin")) {
    if (AUTH) {
      let modNumber = null;
      try {
        modNumber = await moderationFixture();
      } catch (e) {
        log(`FAIL подготовка модерации: ${e.message.slice(0, 200)}`);
      }
      const staff = await createUser("admin", ["admin"], "Администратор Проверки");
      for (const device of DEVICES) await adminScreens(browser, device, staff, modNumber);
    } else skip("20…26 админка", "all", "нет --auth-base на 127.0.0.1");
  }
} finally {
  await browser.close();
  await cleanupUsers(log);
}

// Список снимков с подписями — для сборки слайдов
const TITLES = {
  "01-glavnaya": "Главная: осенняя плашка с промокодом и первый экран",
  "01b-glavnaya-osen": "Главная: сезонный баннер «Осень в фотокниге»",
  "02-katalog": "Каталог: фотокниги и печать фото",
  "03-produkt": "Продукт: фотокнига Classic, цена и сроки",
  "04-redaktor-foto": "Редактор: фото из тестовой галереи",
  "05-redaktor-pravki": "Редактор, «Правки»: плашка «ИИ на телефоне», фото",
  "06-redaktor-ii-komanda": "ИИ-команда словами: «как в старом кино»",
  "06b-redaktor-ii-komanda-celikom": "То же: фото, команда и ответ целиком",
  "07-redaktor-kasanie": "Выделение касанием (модель на устройстве)",
  "08-redaktor-poisk-slovom": "Поиск предмета словом: «размой собаку»",
  "08b-redaktor-poisk-slovom-celikom": "То же: фото и ответ целиком",
  "09-redaktor-foto-ne-uhodyat": "Плашка «ИИ на телефоне — фото никуда не уходят»",
  "09b-plashka-krupno": "Плашка крупно",
  "10-prevyu-knigi": "Автомакет: развороты книги",
  "10b-prevyu-knigi-listat": "Превью книги целиком (N11)",
  "11-proverka": "Проверка перед заказом: дубль, нечёткое фото, пустые страницы",
  "12a-korzina": "Корзина",
  "12-korzina-promokod": "Корзина с промокодом OSEN2026",
  "12b-korzina-itogo": "Итого со скидкой",
  "13a-zakaz-oformlen": "«Заказ оформлен»",
  "13-otkrytka": "Открытка с личным промокодом на следующий заказ",
  "14a-zakaz": "Страница заказа",
  "14-zakaz-statusy": "Заказ со статусами (в производстве, симулятор ERP)",
  "15-podderzhka": "Поддержка: обращение по заказу и ответ",
  "16-moi-zakazy": "«Мои заказы» с кодом открытки",
  "17-pomosch": "Помощь",
  "20-admin-obzor": "Админка: обзор",
  "21-admin-zakazy-filtry": "Админка: заказы с фильтрами",
  "22-admin-promokody": "Админка: промокоды и их статистика",
  "23-admin-sezon": "Админка: сезон оформления",
  "24-admin-moderatsiya": "Модерация: вывод модели словами, фото размыто",
  "25-admin-statistika": "Админка: статистика и воронка",
  "26-admin-zhurnal": "Журнал действий",
};
{
  const lines = [`Снимки PicPac (ночь 2) · ${stamp()} · ${BASE}`, "компьютер 1440×900 @2x, телефон 390×844 @3x, светлая тема, сезон «Осень»", ""];
  for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith(".png")).sort()) {
    const key = f.replace(/-(desktop|phone)\.png$/, "");
    lines.push(`${f} — ${TITLES[key] || ""}`);
  }
  fs.writeFileSync(path.join(OUT, "_spisok.txt"), lines.join("\n") + "\n");
}

const ok = results.filter((r) => r.ok && !r.name.startsWith("_")).length;
const bad = results.filter((r) => !r.ok);
const files = fs.readdirSync(OUT).filter((f) => f.endsWith(".png"));
log(`ИТОГ: снимков в папке ${files.length}, шагов ok ${ok}, не получилось ${bad.length}${bad.length ? ": " + bad.map((r) => `${r.name}-${r.device}`).join(", ") : ""}`);
if (pageErrors.length) {
  log(`ошибки страниц (${pageErrors.length}):`);
  for (const e of [...new Set(pageErrors)].slice(0, 30)) log("  " + e);
}
log(`время прогона: ${log.elapsed()} с`);
