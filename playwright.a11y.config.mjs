// Доступность (S12, D2): те же настройки, что у e2e (playwright.config.mjs), но папка a11y — телефон 390×844 и компьютер 1280×800.
import base from "./playwright.config.mjs";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  ...base,
  testDir: "a11y",
  timeout: 2 * 60_000,
  projects: [
    { name: "телефон 390×844", use: { viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "компьютер 1280×800", use: { viewport: { width: 1280, height: 800 } } },
  ],
});
