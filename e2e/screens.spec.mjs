// Скриншоты ключевых экранов и видео обязательного пути — для презентации (docs/screens/, docs/demo-video.webm).
// В обычный прогон `npm run e2e` не входит: запуск только с SCREENS=1 (скриншоты) или VIDEO=1 (видео, телефон).
//   SCREENS=1 BASE_URL=https://<превью> npx playwright test e2e/screens.spec.mjs
//   VIDEO=1   BASE_URL=https://<превью> npx playwright test e2e/screens.spec.mjs --project="телефон 390×844"
// Временные пользователи e2e-…@example.com (клиент и админ) создаются перед тестом и удаляются после вместе с заказами.
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const PHOTOS = ["sunset-sun", "mir-castle", "nesvizh", "braslav-lake", "bison", "dog", "cat", "autumn-forest", "flowers", "beach", "winter-field", "cake"];
const OUT = path.resolve("docs/screens");

let admin;
let client;
let staff;

// W-15: подмена результата классификатора nsfwjs — «чистое» фото (настоящая модель на CPU в headless ≈ 3 с на фото)
test.beforeEach(async ({ page }) => page.addInitScript(() => (window.__PICPAC_TEST__ = { ...(window.__PICPAC_TEST__ || {}), nsfw: "clean" })));
test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  const tag = Date.now().toString(36).slice(-4) + info.parallelIndex;
  client = await createTestUser(admin, ["client"], "e2e-shot" + tag);
  staff = await createTestUser(admin, ["admin"], "e2e-shotadm" + tag);
});

test.afterEach(async () => {
  for (const u of [client, staff]) {
    if (!u) continue;
    await admin.from("orders").delete().eq("user_id", u.id);
    await deleteTestUser(admin, u);
  }
  client = staff = null;
});

async function login(page, user) {
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}

async function pickFromGallery(page, files) {
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of files) await gallery.locator(`label:has(img[src="/demo-gallery/${f}.jpg"]) input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: `Добавить ${files.length} фото` }).click();
}

// Обязательный путь. shot(name) — снимок экрана (для скриншотов — в светлой и тёмной теме), для видео — пауза
async function corePath(page, shot) {
  await page.goto("/");
  await expect(page.locator('a[href="/product/photopaper-book"]').first()).toBeVisible();
  await shot("01-catalog");

  await page.locator('a[href="/product/photopaper-book"]').first().click();
  await expect(page).toHaveURL(/\/product\/photopaper-book/);
  await shot("02-product");

  await page.getByRole("button", { name: "Создать фотокнигу" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await pickFromGallery(page, PHOTOS);
  await expect(page.locator(".photo-cell img")).toHaveCount(PHOTOS.length, { timeout: 120_000 });

  // ИИ-правка: «убери солнце» на фото «Закат»
  await page.getByRole("button", { name: "Правки", exact: true }).click();
  await page.locator('[data-edit-photo="sunset-sun.jpg"]').click();
  await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1, { timeout: 60_000 });
  await page.getByLabel("Что изменить?").fill("убери солнце");
  await page.getByRole("button", { name: "Сделать" }).click();
  await expect(page.locator(".pe-answer")).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  await shot("03-editor");

  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
  const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
  for (let i = 0; i < 6 && (await toCart.isDisabled()); i++) {
    const fit = page.getByRole("button", { name: /^Сделать \d+ стр\.$/ }).first();
    const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
    if (await fit.isVisible().catch(() => false)) await fit.click();
    else if (await go.isVisible().catch(() => false)) await go.click();
  }
  await toCart.click();
  await expect(page).toHaveURL(/\/cart/);

  // Гость заполняет обязательные поля до входа (баг 6: иначе вход, а потом незаполненная форма)
  await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
  await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
  await page.locator('input[name="delivery"]').first().check();
  await page.locator("#f-pickup_point").selectOption({ index: 1 });
  await page.locator('input[name="payment"]').nth(1).check();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(/\/login\?reason=checkout/);
  await login(page, client);
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByLabel("Имя и фамилия")).toBeVisible();
  await expect.poll(async () => (await client.client.req("/api/v1/cart")).json?.cart?.items?.length, { timeout: 90_000 }).toBe(1);

  await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
  await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
  await page.getByRole("textbox", { name: "Промокод" }).fill("TEST10");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByText(/применён/i).first()).toBeVisible();
  await page.locator('input[name="delivery"]').first().check();
  await page.locator("#f-pickup_point").selectOption({ index: 1 });
  await page.locator('input[name="payment"]').nth(1).check();
  await shot("04-cart");

  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page.getByRole("heading", { name: "Заказ оформлен" })).toBeVisible({ timeout: 120_000 });
  await shot("05-order-placed");
  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await expect(page.getByRole("list", { name: "Статус заказа" }).locator("li")).toHaveCount(5);
}

async function adminStats(browser, info, shot) {
  const u = info.project.use;
  const ctx = await browser.newContext({ viewport: u.viewport, hasTouch: u.hasTouch, locale: "ru-RU", timezoneId: "Europe/Minsk", baseURL: u.baseURL, extraHTTPHeaders: u.extraHTTPHeaders });
  await ctx.addInitScript(() => (window.__PICPAC_TEST__ = { ...(window.__PICPAC_TEST__ || {}), nsfw: "clean" }));
  const page = await ctx.newPage();
  await page.goto("/login");
  await login(page, staff);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  await page.goto("/admin/stats");
  await expect(page.getByRole("heading").first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, "07-admin-stats");
  await page.goto("/admin");
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1000);
  await shot(page, "08-admin");
  await ctx.close();
}

test.describe("скриншоты", () => {
  test.skip(!process.env.SCREENS, "только с SCREENS=1");

  test("ключевые экраны: светлая и тёмная тема", async ({ page, browser }, info) => {
    test.setTimeout(12 * 60_000);
    fs.mkdirSync(OUT, { recursive: true });
    const device = info.project.name.startsWith("телефон") ? "phone" : "desktop";
    const snap = async (p, name) => {
      for (const scheme of ["light", "dark"]) {
        await p.emulateMedia({ colorScheme: scheme });
        await p.waitForTimeout(300);
        await p.screenshot({ path: path.join(OUT, `${device}-${scheme}-${name}.jpg`), type: "jpeg", quality: 78 });
      }
      await p.emulateMedia({ colorScheme: "light" });
    };
    await corePath(page, (name) => snap(page, name));
    // Статусы двигает таймер демо (30 с на шаг) — подождать, чтобы лента была не на первом шаге
    await page.waitForTimeout(65_000);
    await page.reload();
    await expect(page.getByRole("list", { name: "Статус заказа" }).locator("li")).toHaveCount(5);
    await snap(page, "06-order-status");
    await adminStats(browser, info, snap);
  });
});

// Видео: встроенная запись Playwright (recordVideo) требует ffmpeg, а он не ставится на macOS 13.
// Поэтому кадры берём через CDP (Page.startScreencast), а склеиваем в webm сам Chrome: canvas → captureStream → MediaRecorder.
// Длинные паузы сокращаются до 3 с, весь ролик ускоряется так, чтобы уложиться в 115 с.
test.describe("видео", () => {
  test.skip(!process.env.VIDEO, "только с VIDEO=1");

  test("обязательный путь: каталог → проект → ИИ-правка → корзина → номер заказа → статус", async ({ page }, info) => {
    test.setTimeout(12 * 60_000);
    const { width, height } = info.project.use.viewport;
    const cdp = await page.context().newCDPSession(page);
    const frames = [];
    cdp.on("Page.screencastFrame", (f) => {
      const t = f.metadata.timestamp;
      if (!frames.length || t - frames[frames.length - 1].t >= 0.15) frames.push({ data: f.data, t });
      cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 60, maxWidth: width, maxHeight: height });
    await corePath(page, () => page.waitForTimeout(1500));
    await page.waitForTimeout(3000);
    await cdp.send("Page.stopScreencast");

    const gaps = frames.map((f, k) => (k + 1 < frames.length ? Math.min(3, frames[k + 1].t - f.t) : 2));
    const total = gaps.reduce((a, b) => a + b, 0);
    const speed = Math.max(1, total / 115);
    const rec = await page.context().newPage();
    await rec.goto("about:blank");
    for (let k = 0; k < frames.length; k += 80)
      await rec.evaluate((arr) => (window.F = (window.F || []).concat(arr)), frames.slice(k, k + 80).map((f, j) => ({ d: (gaps[k + j] * 1000) / speed, data: f.data })));
    const b64 = await rec.evaluate(
      async ({ w, h }) => {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        document.body.appendChild(c);
        const ctx = c.getContext("2d");
        const mr = new MediaRecorder(c.captureStream(25), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1_200_000 });
        const chunks = [];
        mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        mr.start(1000);
        for (const f of window.F) {
          const img = new Image();
          img.src = "data:image/jpeg;base64," + f.data;
          await img.decode();
          ctx.drawImage(img, 0, 0, w, h);
          await new Promise((r) => setTimeout(r, f.d));
        }
        mr.stop();
        await new Promise((r) => (mr.onstop = r));
        const buf = new Uint8Array(await new Blob(chunks, { type: "video/webm" }).arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return btoa(s);
      },
      { w: width, h: height },
    );
    fs.writeFileSync(path.resolve("docs/demo-video.webm"), Buffer.from(b64, "base64"));
    console.log(`видео: ${frames.length} кадров, ${Math.round(total)} с записи, ускорение ×${speed.toFixed(2)}`);
  });
});
