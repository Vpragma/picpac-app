// Доступность (S12): те же настройки, что у e2e (playwright.config.mjs), но папка a11y и только телефон 390×844.
import base from "./playwright.config.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "a11y",
  timeout: 2 * 60_000,
  projects: [{ name: "телефон 390×844", use: { viewport: { width: 390, height: 844 }, hasTouch: true } }],
});
