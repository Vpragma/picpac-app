// Playwright e2e: обязательный путь ТЗ и критерии приёмки 6.4 (AC-1…AC-5).
// Запуск: npm run e2e (локально нужен запущенный сервер: npm run build && npm start)
// или BASE_URL=https://<превью> npm run e2e.
// Браузер — установленный Google Chrome (channel: "chrome"): свой Chromium Playwright на macOS 13 не ставится.
import { defineConfig } from "@playwright/test";

try {
  process.loadEnvFile(".env.local"); // ключ Supabase для создания и удаления тестового пользователя e2e-…@example.com
} catch {}

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export default defineConfig({
  testDir: "e2e",
  timeout: 8 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  outputDir: ".night-logs/e2e-results",
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    headless: true,
    locale: "ru-RU",
    timezoneId: "Europe/Minsk",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    extraHTTPHeaders: bypass ? { "x-vercel-protection-bypass": bypass } : undefined,
    // N1: онбординг первого входа уже пройден — тесты сразу видят экраны (сам онбординг проверяет e2e/brand.spec.mjs)
    storageState: { cookies: [], origins: [{ origin: new URL(BASE_URL).origin, localStorage: [{ name: "pp:onboarding", value: "done" }] }] },
  },
  projects: [
    { name: "телефон 390×844", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "компьютер 1280×800", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
