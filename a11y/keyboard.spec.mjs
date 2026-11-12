// D2: клавиатура (N-13), «Крупный текст» (M-10), кнопки на миниатюрах фото ≥ 44×44 (N-12), помощь и ошибки (N-10, N-11).
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { smallTargets } from "./helpers.mjs";

test("первый Tab — «Перейти к содержимому», Enter переводит фокус в содержимое", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Перейти к содержимому" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  // дальше Tab идёт по содержимому, а не по шапке
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => !!document.activeElement.closest("#main"))).toBe(true);
});

test("«Крупный текст»: включается в профиле, сохраняется после перезагрузки, выключается", async ({ page }) => {
  await page.goto("/profile", { waitUntil: "load" });
  const sw = page.getByRole("switch", { name: "Крупный текст" });
  await expect(sw).not.toBeChecked();
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
  await sw.check();
  await expect(page.locator("html")).toHaveAttribute("data-text", "lg");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("20px");
  await page.goto("/help", { waitUntil: "load" });
  // атрибут ставит сервер из cookie — уже в HTML, без мигания
  await expect(page.locator("html")).toHaveAttribute("data-text", "lg");
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("20px");
  await page.goto("/profile", { waitUntil: "load" });
  await expect(page.getByRole("switch", { name: "Крупный текст" })).toBeChecked();
  await page.getByRole("switch", { name: "Крупный текст" }).uncheck();
  await expect(page.locator("html")).not.toHaveAttribute("data-text", "lg");
  await page.reload({ waitUntil: "load" });
  expect(await page.evaluate(() => getComputedStyle(document.body).fontSize)).toBe("16px");
});

test("помощь: телефон и почта ссылками, ответы раскрываются; 404 и неизвестный продукт — по-русски", async ({ page }) => {
  await page.goto("/help", { waitUntil: "load" });
  await expect(page).toHaveTitle("Помощь — PicPac");
  await expect(page.getByRole("link", { name: /Позвонить: \+375 44 539-67-89/ })).toHaveAttribute("href", "tel:+375445396789");
  await expect(page.getByRole("link", { name: /support@picpac\.by/ }).first()).toHaveAttribute("href", "mailto:support@picpac.by");
  await page.getByText("Перепечатка, если брак").click();
  await expect(page.getByText("Брак печати — перепечатаем бесплатно.")).toBeVisible();
  // ссылка на помощь есть в шапке
  await page.goto("/", { waitUntil: "load" });
  await page.locator(".topbar").getByRole("link", { name: "Помощь" }).click();
  await expect(page).toHaveURL(/\/help$/);
  const r = await page.goto("/product/no-such-product-d2");
  expect(r.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Такой страницы нет" })).toBeVisible();
  for (const [path, title] of [
    ["/cart", "Корзина — PicPac"],
    ["/books", "Мои книги — PicPac"],
    ["/orders", "Мои заказы — PicPac"],
    ["/editor", "Редактор фотокниги — PicPac"],
  ]) {
    await page.goto(path, { waitUntil: "load" });
    await expect(page).toHaveTitle(title);
  }
});

test("редактор с фото: кнопки на миниатюрах ≥ 44×44, на телефоне две колонки, axe без серьёзных нарушений", async ({ page }) => {
  await page.goto("/product/photo", { waitUntil: "load" });
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["cat-dark", "mir-castle", "braslav-lake-bright"]) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 3 фото" }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(3);
  const tools = page.locator(".photo-tools button").first();
  await expect(tools).toBeVisible();
  const box = await tools.boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(await smallTargets(page), "цели касания меньше 44×44").toEqual([]);
  const vw = page.viewportSize().width;
  if (vw < 500) {
    const cols = await page.locator(".photo-grid").first().evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
    expect(cols).toBe(2);
  }
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad, bad.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n")).toEqual([]);
});
