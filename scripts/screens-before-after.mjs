// N1: скриншоты «было / стало» для презентации (открытые экраны, без входа).
// Запуск: node scripts/screens-before-after.mjs <base-url> <before|after> [light|dark]
// dark: телефон в тёмном режиме + cookie pp_theme=dark (после N1 тёмная тема включается в профиле)
// Пишет в docs/presentation/screens-v2/before-after/<label>-<phone|desktop>-<экран>.jpg
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const [base = "http://127.0.0.1:3301", label = "after", scheme = "light"] = process.argv.slice(2);
const OUT = path.resolve("docs/presentation/screens-v2/before-after");
const PAGES = [
  ["/", "01-home"],
  ["/product/layflat", "02-product-classic"],
  ["/product/photo", "03-product-photo"],
  ["/books", "04-books"],
  ["/editor", "05-editor"],
  ["/cart", "06-cart"],
  ["/orders", "07-orders"],
  ["/profile", "08-profile"],
  ["/help", "09-help"],
  ["/login", "10-login"],
];
const VIEWPORTS = [
  ["phone", { width: 390, height: 844 }, 2],
  ["desktop", { width: 1440, height: 900 }, 1],
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
for (const [device, viewport, dpr] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: dpr,
    locale: "ru-RU",
    timezoneId: "Europe/Minsk",
    colorScheme: scheme,
    hasTouch: device === "phone",
    // онбординг пропускаем: снимаем сами экраны
    storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: "pp:onboarding", value: "done" }] }] },
  });
  // после N1 тёмная тема — выбор в профиле (cookie pp_theme); до N1 сайт следовал теме телефона
  if (scheme === "dark") await ctx.addCookies([{ name: "pp_theme", value: "dark", url: base }]);
  const page = await ctx.newPage();
  for (const [p, name] of PAGES) {
    try {
      await page.goto(base + p, { waitUntil: "load", timeout: 90_000 });
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      await page.waitForTimeout(800);
      const file = path.join(OUT, `${label}-${device}${scheme === "dark" ? "-dark" : ""}-${name}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 80 });
      console.log("ok", file);
    } catch (e) {
      console.log("fail", p, e.message.split("\n")[0]);
    }
  }
  await ctx.close();
}
await browser.close();
