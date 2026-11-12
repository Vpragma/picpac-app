// Дубли фото: плашка «Найдено дублей: N. Удалить?» → «Удалить дубли» (первое фото остаётся) → тост «Удалено дублей: 1»
// с «Вернуть» → «Оставить» прячет плашку, значок «Дубль» остаётся → на «Проверке» кнопка «Удалить дубль». Гость, без базы.
import { expect, test } from "@playwright/test";

test("дубли: удалить, вернуть, оставить, удалить на «Проверке»", async ({ page }) => {
  test.slow();
  await page.goto("/product/photopaper-book");
  await page.getByRole("button", { name: "Создать фотокнигу" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["flowers", "flowers-2"]) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 2 фото" }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 180_000 });

  const banner = page.getByText("Найдено дублей: 1. Удалить?");
  await expect(banner).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Удалить дубли" }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(1);
  await expect(page.locator('.photo-cell[data-photo="flowers.jpg"]')).toHaveCount(1); // первое фото осталось
  await expect(page.getByText("Удалено дублей: 1")).toBeVisible();
  await page.getByRole("button", { name: "Вернуть" }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2);
  await expect(page.getByText("Удалено дублей: 1")).toHaveCount(0);

  await expect(banner).toBeVisible();
  await page.getByRole("button", { name: "Оставить" }).click();
  await expect(banner).toHaveCount(0);
  await expect(page.locator('.photo-cell[data-photo="flowers-2.jpg"] .pe-badge')).not.toHaveCount(0); // значок «Дубль» остался

  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
  await page.getByRole("button", { name: "Удалить дубль «flowers-2.jpg»" }).click();
  await expect(page.getByText("Удалено дублей: 1")).toBeVisible();
  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Фото" }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(1);
});
