// Общие помощники скриптов презентации (present-screens, present-before-after, present-video).
// Устройства: компьютер 1440×900 @2x и телефон 390×844 @3x (мобильная эмуляция Chromium), светлая тема,
// онбординг пройден. Тестовые пользователи — только night2-mat-…@example.com: создаются сервисным ключом
// (как в tests/helpers), пароль случайный и нигде не печатается, после прогона удаляются вместе с данными.
// Вход под аккаунтами — только на своём сервере 127.0.0.1 (на превью Vercel — только открытые экраны).
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

export const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

export const DEVICES = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
};

// --ключ значение | --ключ=значение | --флаг
export function parseArgs(argv, defaults = {}) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = "true";
  }
  return out;
}

export const trimBase = (u) => (u ? String(u).replace(/\/+$/, "") : u);
export const isLocal = (u) => /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(trimBase(u) || "");

// Журнал прогона: в консоль и в файл
export function makeLog(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `# ${new Date().toISOString()}\n`);
  const t0 = Date.now();
  const log = (...a) => {
    const line = `[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} с] ${a.join(" ")}`;
    console.log(line);
    fs.appendFileSync(file, line + "\n");
  };
  log.elapsed = () => Math.round((Date.now() - t0) / 1000);
  return log;
}

// Контекст браузера: устройство, светлая тема, онбординг пройден. Аналитика не уходит в общую базу (ответ-заглушка),
// классификатор nsfw на устройстве — «чисто» (как в e2e: модель на CPU в headless ≈ 3 с на фото; сервер всё равно проверяет).
export async function newContext(browser, device, base, extra = {}) {
  const origin = new URL(base).origin;
  const ctx = await browser.newContext({
    ...DEVICES[device],
    locale: "ru-RU",
    timezoneId: "Europe/Minsk",
    colorScheme: "light",
    ...extra,
    storageState: { cookies: [], origins: [{ origin, localStorage: [{ name: "pp:onboarding", value: "done" }] }] },
  });
  await ctx.addCookies([{ name: "pp_theme", value: "light", url: origin }]);
  await ctx.addInitScript(() => {
    window.__PICPAC_TEST__ = { ...(window.__PICPAC_TEST__ || {}), nsfw: "clean" };
    try {
      localStorage.setItem("pp:onboarding", "done");
    } catch {}
  });
  await ctx.route("**/api/v1/events", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  return ctx;
}

// Дождаться сети, шрифтов и картинок в видимой области
export async function settle(page, ms = 500) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page
    .evaluate(async () => {
      const vis = [...document.images].filter((im) => {
        const r = im.getBoundingClientRect();
        return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
      });
      const wait = vis.map((im) =>
        im.complete ? null : new Promise((res) => (im.addEventListener("load", res, { once: true }), im.addEventListener("error", res, { once: true }))),
      );
      await Promise.race([Promise.all(wait), new Promise((r) => setTimeout(r, 10_000))]);
      if (document.fonts?.ready) await document.fonts.ready;
    })
    .catch(() => {});
  await page.waitForTimeout(ms);
}

// Прокрутить так, чтобы верх элемента оказался под шапкой
export async function scrollToEl(page, locator, offset = 76) {
  const el = typeof locator === "string" ? page.locator(locator).first() : locator.first();
  await el.waitFor({ state: "attached", timeout: 30_000 });
  await el.evaluate((node, off) => {
    const top = node.getBoundingClientRect().top + window.scrollY - off;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, offset);
  await page.waitForTimeout(350);
}

export async function scrollTop(page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.waitForTimeout(250);
}

// Фото и ответ ИИ в одном кадре: если помещаются — фото под шапкой, иначе низ ответа у нижнего края
// (на телефоне — над нижней панелью с ценой и над нижним меню)
export async function alignAnswer(page, extra = 0) {
  await page.evaluate((extra) => {
    const a = document.querySelector(".pe-answer");
    const ph = document.querySelector(".pe-after");
    if (!a || !ph) return;
    const header = document.querySelector("header")?.getBoundingClientRect().bottom || 60;
    let inset = 0;
    for (const el of document.querySelectorAll(".sticky-bar, nav, [class*='tabbar'], [class*='bottom']")) {
      const r = el.getBoundingClientRect();
      const pos = getComputedStyle(el).position;
      if ((pos === "fixed" || pos === "sticky") && r.height > 0 && r.top > innerHeight / 2 && r.top < innerHeight) inset = Math.max(inset, innerHeight - r.top);
    }
    const ab = a.getBoundingClientRect().bottom + scrollY;
    const pt = ph.getBoundingClientRect().top + scrollY;
    const room = innerHeight - header - inset - extra;
    const top = ab - pt + 40 <= room ? pt - header - 12 : ab - (innerHeight - inset - extra) + 20;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, extra);
  await page.waitForTimeout(400);
}
// Сезон «Осень» включён? Ждём до maxMs (параллельный тест сезона может временно переключить его)
export async function checkSeason(base, log, want = "autumn", maxMs = 90_000) {
  const t0 = Date.now();
  let last = "?";
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(trimBase(base) + "/api/v1/season", { cache: "no-store" });
      last = (await r.json())?.season || "?";
      if (last === want) {
        log(`сезон: ${last} (GET /api/v1/season)`);
        return true;
      }
    } catch (e) {
      last = "ошибка: " + e.message;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  log(`ВНИМАНИЕ: сезон сейчас «${last}», а не «${want}» — снимки будут без осени`);
  return false;
}

// Сезон в общей базе могут на время переключить чужие тесты (e2e сезона). Перед экранами, где нужна «Осень»
// (плашка, баннер, OSEN2026), ждём её до maxMs; страница перезагружается, если показала другой сезон.
export async function ensureAutumn(page, base, log, maxMs = 180_000) {
  const ok = await checkSeason(base, () => {}, "autumn", maxMs);
  if (!ok) log(`ВНИМАНИЕ: сезон не «Осень» дольше ${Math.round(maxMs / 1000)} с — снимаем как есть`);
  if (page) {
    const shown = await page.locator("html").getAttribute("data-season").catch(() => null);
    if (shown && shown !== "autumn") {
      await page.reload({ waitUntil: "load" }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    }
  }
  return ok;
}

// Применить промокод в корзине; при отказе (сезон переключили) — дождаться «Осени» и повторить
export async function applyPromo(page, code, base, log, { typeDelay = 0 } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const box = page.getByRole("textbox", { name: "Промокод" });
    if (await box.isVisible().catch(() => false)) {
      await box.fill("");
      if (typeDelay) await box.pressSequentially(code, { delay: typeDelay });
      else await box.fill(code);
      await page.getByRole("button", { name: "Применить", exact: true }).click();
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 15_000) {
      const applied = await page.getByTestId("promo-applied").innerText().catch(() => "");
      if (new RegExp(code, "i").test(applied)) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    const msg = await page.getByTestId("promo-msg").innerText().catch(() => "");
    log(`     промокод ${code} не применился (попытка ${attempt}): ${msg.slice(0, 120)}`);
    await ensureAutumn(null, base, log, 120_000);
  }
  return false;
}

// ---------- тестовые пользователи night2-mat-… ----------

let admin = null;
export function adminClient() {
  if (!admin) admin = supabaseAdmin();
  return admin;
}

const created = [];

// Почта без случайного хвоста (night2-mat-anna@example.com — так она выглядит на снимках). Остаток прошлого прогона
// с той же почтой (если прогон оборвался) удаляется перед созданием.
export async function createUser(label, roles = ["client"], fullName = "Анна Иванова") {
  const a = adminClient();
  const email = `night2-mat-${label}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const make = () => a.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  let { data, error } = await make();
  if (error && /already|exists|registered/i.test(error.message)) {
    await removeLeftover(email);
    ({ data, error } = await make());
  }
  if (error) throw new Error("не создать тестового пользователя: " + error.message);
  const user = { id: data.user.id, email, password };
  created.push(user);
  if (!roles.includes("client")) await a.from("user_roles").delete().eq("user_id", user.id).eq("role", "client");
  for (const role of roles.filter((r) => r !== "client")) await a.from("user_roles").upsert({ user_id: user.id, role });
  return user;
}

async function removeLeftover(email) {
  const a = adminClient();
  for (let page = 1; page <= 30; page++) {
    const { data, error } = await a.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users?.length) return;
    const u = data.users.find((x) => (x.email || "").toLowerCase() === email);
    if (u) {
      await a.from("promo_codes").delete().eq("owner_user_id", u.id);
      await deleteTestUser(a, { id: u.id, email });
      return;
    }
    if (data.users.length < 200) return;
  }
}

// Удалить всех созданных: личные промокоды открыток, заказы, файлы, пользователя
export async function cleanupUsers(log) {
  const a = adminClient();
  for (const u of created.splice(0)) {
    try {
      await a.from("promo_codes").delete().eq("owner_user_id", u.id);
      await deleteTestUser(a, u);
      const { data } = await a.auth.admin.getUserById(u.id);
      log(data?.user ? `НЕ удалён тестовый пользователь ${u.email}` : `удалён тестовый пользователь ${u.email}`);
    } catch (e) {
      log(`ошибка удаления ${u.email}: ${e.message}`);
    }
  }
}

// Вход в контекст браузера (cookie сессии общие для всех страниц контекста)
export async function loginContext(ctx, authBase, user) {
  const r = await ctx.request.post(trimBase(authBase) + "/api/v1/auth/login", { data: { email: user.email, password: user.password } });
  if (r.status() !== 200) throw new Error("вход: код " + r.status());
}

// Проект с фото и корзина на сервере (как в e2e/promo.spec.mjs). files — из public/demo-gallery
export async function serverProjectInCart(ctx, authBase, { slug = "layflat", title = "Осень", options = { size: "20x20", pages: 20 }, files = [], extraPhotos = [] }) {
  const base = trimBase(authBase);
  const json = async (r) => {
    const t = await r.text();
    try {
      return JSON.parse(t);
    } catch {
      return { raw: t.slice(0, 200) };
    }
  };
  const p = await json(await ctx.request.post(base + "/api/v1/projects", { data: { productSlug: slug, title, options } }));
  const projectId = p?.project?.id;
  if (!projectId) throw new Error("проект не создан: " + JSON.stringify(p).slice(0, 200));
  const buffers = [...files.map((f) => fs.readFileSync(new URL(`../public/demo-gallery/${f}`, import.meta.url))), ...extraPhotos.map((x) => x.buffer)];
  const nsfw = extraPhotos.map((x) => x.nsfw);
  for (let i = 0; i < buffers.length; i++) {
    const buf = buffers[i];
    const u = await json(await ctx.request.post(`${base}/api/v1/projects/${projectId}/photos/upload-url`, { data: { mime: "image/jpeg", bytes: buf.length } }));
    if (!u?.upload?.url) throw new Error("нет ссылки загрузки: " + JSON.stringify(u).slice(0, 200));
    const put = await fetch(u.upload.url, { method: "PUT", headers: u.upload.headers, body: buf });
    if (!put.ok) throw new Error("загрузка фото: " + put.status);
    const extra = i >= files.length && nsfw[i - files.length] ? { nsfw: nsfw[i - files.length] } : {};
    const ph = await ctx.request.post(`${base}/api/v1/projects/${projectId}/photos`, { data: { path: u.upload.path, ...extra } });
    if (!ph.ok()) throw new Error("фото в проект: " + ph.status());
  }
  const cart = await json(await ctx.request.put(base + "/api/v1/cart", { data: { items: [{ projectId, quantity: 1 }] } }));
  if (!cart?.cart?.items?.length) throw new Error("корзина не собралась: " + JSON.stringify(cart).slice(0, 200));
  return { projectId, cart: cart.cart };
}

export const stamp = () => new Date().toLocaleString("ru-RU", { timeZone: "Europe/Minsk" });
