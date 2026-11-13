// N11 · доступность превью книги и шага «Автомакет» (выбор шаблона и обложки), светлая и тёмная тема,
// телефон 390×844 и компьютер 1280×800: axe WCAG 2.0/2.1/2.2 A и AA — 0 серьёзных и критических нарушений,
// цели касания ≥ 44×44; то же для книги на весь экран (диалог «Книга целиком»). Гость, без входа.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { smallTargets } from "./helpers.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function serious(result) {
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return { bad, text: bad.map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n") };
}

for (const scheme of ["light", "dark"]) {
  test(`«Автомакет» книги и превью на весь экран, ${scheme === "light" ? "светлая" : "тёмная"} тема: нет серьёзных нарушений`, async ({ page }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: "dark" });
    if (scheme === "dark") await page.context().addCookies([{ name: "pp_theme", value: "dark", url: test.info().project.use.baseURL }]);
    await page.goto("/product/layflat");
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme);
    await page.getByRole("button", { name: "Создать фотокнигу" }).click();
    await expect(page).toHaveURL(/\/editor/);
    await page.getByRole("button", { name: "Тестовая галерея" }).click();
    const gallery = page.getByRole("region", { name: "Тестовая галерея" });
    await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
    await gallery.getByRole("button", { name: "Снять выбор" }).click();
    const boxes = gallery.locator("label[data-file] input[type=checkbox]");
    for (let i = 0; i < 3; i++) await boxes.nth(i).check();
    await gallery.getByRole("button", { name: "Добавить 3 фото" }).click();
    await expect(page.locator(".photo-cell img")).toHaveCount(3, { timeout: 120_000 });
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Автомакет" }).click();
    await expect(page.locator(".bk-wrap")).toBeVisible();
    // обложка с текстом — контраст подписи проверяется тоже
    await page.getByRole("textbox", { name: "Название", exact: true }).fill("Лето у бабушки");
    await page.getByRole("textbox", { name: "Дата", exact: true }).fill("август 2026");
    await page.waitForTimeout(400);

    for (const cover of ["Фото и подпись", "Фото на всю обложку", "Только название"]) {
      await page.getByRole("radio", { name: cover }).check();
      const r = serious(await new AxeBuilder({ page }).withTags(TAGS).analyze());
      expect(r.bad, `обложка «${cover}»:\n${r.text}`).toEqual([]);
    }
    for (const tpl of ["Классика", "Осень", "Свадьба", "Малыш", "Путешествие"]) {
      await page.getByRole("radio", { name: new RegExp("^" + tpl) }).check();
      const r = serious(await new AxeBuilder({ page }).include(".bk-wrap").withTags(TAGS).analyze());
      expect(r.bad, `шаблон «${tpl}»:\n${r.text}`).toEqual([]);
    }
    if (scheme === "light") expect(await smallTargets(page), "цели касания меньше 44×44").toEqual([]);

    await page.getByRole("button", { name: "Посмотреть книгу целиком" }).click();
    const dialog = page.getByRole("dialog", { name: "Книга целиком" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(900);
    const r = serious(await new AxeBuilder({ page }).withTags(TAGS).analyze());
    expect(r.bad, `на весь экран:\n${r.text}`).toEqual([]);
    if (scheme === "light") expect(await smallTargets(page), "цели касания меньше 44×44 на весь экран").toEqual([]);
  });
}
