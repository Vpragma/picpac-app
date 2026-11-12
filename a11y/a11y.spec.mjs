// Доступность (S12, D2): axe-core на ключевых страницах — телефон 390×844 и компьютер 1280×800, светлая и тёмная тема.
// Правила WCAG 2.0/2.1/2.2 A и AA. Условие: 0 нарушений уровня «серьёзное» (serious) и «критическое» (critical).
// Плюс: все кнопки и отдельные ссылки — не меньше 44×44 (axe этого не проверяет), отчёт о «нужна ручная проверка» по контрасту.
// Запуск: npm run test:a11y (сервер на http://127.0.0.1:3000) или BASE_URL=http://127.0.0.1:<порт> npm run test:a11y.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { smallTargets } from "./helpers.mjs";

const PAGES = [
  ["/", "Главная"],
  ["/product/pages-book", "Карточка фотокниги"],
  ["/product/layflat", "Карточка Classic"],
  ["/product/photo", "Карточка «Печать фото»"],
  ["/books", "Мои книги"],
  ["/editor", "Редактор"],
  ["/cart", "Корзина"],
  ["/orders", "Мои заказы"],
  ["/profile", "Профиль"],
  ["/help", "Помощь"],
  ["/login", "Вход"],
  ["/no-such-page-d2", "Страница 404"],
];

for (const scheme of ["light", "dark"]) {
  for (const [path, name] of PAGES) {
    test(`${name} (${path}), ${scheme === "light" ? "светлая" : "тёмная"} тема: нет серьёзных и критических нарушений`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path, { waitUntil: "load" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(500);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const report = bad.map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
      const other = result.violations.filter((v) => !bad.includes(v));
      const manual = result.incomplete.filter((v) => v.id === "color-contrast").flatMap((v) => v.nodes.map((n) => n.target.join(" ")));
      console.log(
        `${path} ${scheme}: проверок пройдено ${result.passes.length}, лёгкие и средние нарушения: ${other.map((v) => `${v.impact} ${v.id}`).join(", ") || "нет"}` +
          (manual.length ? `; контраст «проверить руками»: ${manual.length}` : ""),
      );
      expect(bad, report).toEqual([]);
      if (scheme === "light") expect(await smallTargets(page), "цели касания меньше 44×44").toEqual([]);
    });
  }
}
