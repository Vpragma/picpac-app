// N1 · фирменный стиль: светлая тема по умолчанию, выбор темы в профиле, главная кнопка без градиента,
// новая главная (слоган, коллаж, плашки), онбординг первого входа. Только открытые экраны, без входа.
import { expect, test } from "@playwright/test";

const CREAM = "rgb(250, 245, 237)";
const RED = "rgb(189, 52, 52)";

test("светлая тема по умолчанию даже при тёмной теме телефона; кнопка — сплошной #bd3434", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(CREAM);
  const hero = page.locator(".hero");
  await expect(hero.getByRole("heading", { level: 1 })).toHaveText(/машина времени для ваших счастливых мгновений/);
  // одна главная кнопка на первом экране
  await expect(hero.locator(".btn-primary")).toHaveCount(1);
  const btn = await hero.locator(".btn-primary").evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, img: getComputedStyle(el).backgroundImage, color: getComputedStyle(el).color }));
  expect(btn).toEqual({ bg: RED, img: "none", color: "rgb(255, 255, 255)" });
  // коллаж: фото с размерами, приоритет только у первого
  const imgs = hero.locator(".collage img");
  expect(await imgs.count()).toBeGreaterThanOrEqual(3);
  await expect(imgs.first()).toHaveAttribute("fetchpriority", "high");
  await expect(imgs.nth(1)).toHaveAttribute("loading", "lazy");
  // каталог с плашками: Classic — «выбор pic pac» и «180°»
  const classic = page.locator('a[href="/product/layflat"]').first();
  await expect(classic.locator(".tag-choice")).toHaveText(/выбор pic pac/i);
  await expect(classic.locator(".tag-180")).toBeVisible();
  // ни одного градиента на кнопках и плашках
  const gradients = await page.evaluate(() => [...document.querySelectorAll(".btn, .tag, .chip, .badge, .status-chip")].filter((el) => getComputedStyle(el).backgroundImage.includes("gradient")).length);
  expect(gradients).toBe(0);
});

test("профиль: «Тема: светлая / тёмная / как в системе» — сохраняется и без мигания после перезагрузки", async ({ page }) => {
  await page.goto("/profile");
  const group = page.getByTestId("theme-setting");
  await expect(group.getByRole("radio", { name: "Светлая" })).toBeChecked();
  await group.getByText("Тёмная", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBg).not.toBe(CREAM);
  // сервер сам отдаёт тёмную тему (атрибут в первом HTML — без мигания)
  const html = await (await page.request.get("/")).text();
  expect(html).toMatch(/<html[^>]*data-color-scheme="dark"/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "dark");
  await expect(page.getByTestId("theme-setting").getByRole("radio", { name: "Тёмная" })).toBeChecked();
  // «как в системе» следует настройке устройства
  await page.getByTestId("theme-setting").getByText("Как в системе", { exact: true }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(darkBg);
  await page.emulateMedia({ colorScheme: "light" });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(CREAM);
  await page.getByTestId("theme-setting").getByText("Светлая", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-color-scheme", "light");
});

test.describe("онбординг первого входа", () => {
  // без заранее поставленного флага (в остальных тестах его ставит playwright.config.mjs)
  test.use({ storageState: { cookies: [], origins: [] } });

  test("3 экрана, «Пропустить» и «Начать», второй раз не показывается", async ({ page }) => {
    await page.goto("/");
    const dlg = page.getByTestId("onboarding");
    await expect(dlg).toBeVisible({ timeout: 15_000 });
    await expect(dlg.getByRole("heading")).toHaveText("Ваши фото заслуживают книги");
    await dlg.getByRole("button", { name: "Дальше" }).click();
    await expect(dlg.getByRole("heading")).toHaveText("Помощник всё подскажет");
    await dlg.getByRole("button", { name: "Дальше" }).click();
    await dlg.getByRole("button", { name: "Начать" }).click();
    await expect(dlg).toHaveCount(0);
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("onboarding")).toHaveCount(0);
  });

  test("«Пропустить» закрывает сразу", async ({ page }) => {
    await page.goto("/");
    const dlg = page.getByTestId("onboarding");
    await expect(dlg).toBeVisible({ timeout: 15_000 });
    await dlg.getByRole("button", { name: "Пропустить" }).click();
    await expect(dlg).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("pp:onboarding"))).toBe("done");
  });
});
