// Доступность (S12): axe-core на ключевых страницах на телефоне 390×844, светлая и тёмная тема.
// Правила WCAG 2.1 A и AA. Условие: 0 нарушений уровня «серьёзное» (serious) и «критическое» (critical).
// Запуск: npm run test:a11y (сервер на http://127.0.0.1:3000) или BASE_URL=https://<превью> npm run test:a11y.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const PAGES = [
  ["/", "Главная"],
  ["/product/classic", "Карточка Classic"],
  ["/books", "Мои книги"],
  ["/editor", "Редактор"],
  ["/cart", "Корзина"],
  ["/login", "Вход"],
];

for (const scheme of ["light", "dark"]) {
  for (const [path, name] of PAGES) {
    test(`${name} (${path}), ${scheme === "light" ? "светлая" : "тёмная"} тема: нет серьёзных и критических нарушений`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(500);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
      const other = result.violations.filter((v) => !bad.includes(v));
      console.log(`${path} ${scheme}: проверок пройдено ${result.passes.length}, лёгкие и средние нарушения: ${other.map((v) => `${v.impact} ${v.id}`).join(", ") || "нет"}`);
      expect(bad, report).toEqual([]);
    });
  }
}
