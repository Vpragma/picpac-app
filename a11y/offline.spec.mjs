// N7 (критик C): доступность экранов без сети — «Нет сети» (/offline.html) в светлой и тёмной теме и понятный текст
// редактора «Без сети этот шаг пока недоступен…» (кусок «Правок» не скачан). axe WCAG 2.x A/AA: 0 серьёзных и критических.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";

async function axeBad(page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return result.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

for (const scheme of ["light", "dark"]) {
  test(`«Нет сети» (/offline.html), ${scheme === "light" ? "светлая" : "тёмная"}: нет серьёзных нарушений`, async ({ page }) => {
    // Без воркера атрибута темы нет — страница следует настройке телефона (prefers-color-scheme)
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/offline.html");
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === "dark" ? "rgb(23, 35, 33)" : "rgb(250, 245, 237)");
    expect(await axeBad(page)).toEqual([]);
  });
}

test.describe("редактор: кусок «Правок» не скачан", () => {
  test.use({ serviceWorkers: "block" });
  for (const scheme of ["light", "dark"]) {
    test(`«Без сети этот шаг пока недоступен», ${scheme === "light" ? "светлая" : "тёмная"}: нет серьёзных нарушений`, async ({ page, context }) => {
      await context.addInitScript(() => localStorage.setItem("pp:onboarding", "done"));
      if (scheme === "dark") await context.addCookies([{ name: "pp_theme", value: "dark", url: test.info().project.use.baseURL }]);
      await context.route(/\/_next\/static\/chunks\/.+\.js/, async (route) => {
        const res = await route.fetch();
        const body = await res.text();
        if (body.includes("pe-select-row")) return route.abort("internetdisconnected");
        return route.fulfill({ response: res, body });
      });
      await page.goto("/product/photo");
      await page.getByRole("button", { name: "Выбрать фото" }).click();
      await expect(page).toHaveURL(/\/editor/);
      await page.locator('input[type="file"][multiple]').setInputFiles([path.resolve("public/demo-gallery/bison.jpg")]);
      await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(1, { timeout: 30_000 });
      await page.getByRole("button", { name: "Правки", exact: true }).click();
      await expect(page.locator("[data-offline-step]")).toBeVisible({ timeout: 20_000 });
      expect(await axeBad(page)).toEqual([]);
      await context.unrouteAll({ behavior: "ignoreErrors" });
    });
  }
});
