// День 3, задача 2: «Нужно к дате» на странице фотокниги Classic. Телефон 390×844 и компьютер 1280×800.
// «Сегодня» в браузере — 13 ноября 2026, 10:00 по Минску (page.clock); сроки — из расчёта страницы
// (печать 3 дня + дни способа из каталога): 18 ноября — успевают EMS и курьер по Минску; 15 ноября — «не успеем»;
// крестик — блок как раньше; прошлая дата (если браузер пропустил min) — просим другую. Вход не нужен, данных не создаёт.
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-13T10:00:00+03:00"));
});

test("«Нужно к дате»: 18 ноября, 15 ноября, крестик, прошлая дата", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/product/layflat");
  const box = page.getByTestId("need-by");
  const field = page.getByLabel("Нужно к дате");
  await expect(box.getByText("Выберите дату")).toBeVisible();
  await expect(page.getByText("Сроки и цена других способов доставки")).toBeVisible();

  await test.step("18 ноября: EMS и курьер по Минску «Успеете», остальные «Не успеете»", async () => {
    await field.fill("2026-11-18");
    await expect(box.getByText("18 ноября", { exact: true })).toBeVisible();
    for (const code of ["ems", "courier-minsk"]) await expect(page.getByTestId("eta-" + code)).toContainText("✓ Успеете");
    for (const code of ["europost", "belpost", "courier-by"]) await expect(page.getByTestId("eta-" + code)).toContainText("Не успеете");
    await expect(page.getByTestId("eta-ems")).toContainText("17–18 ноября");
    await expect(page.getByText("К этой дате не успеем")).toHaveCount(0);
  });

  await test.step("15 ноября: «К этой дате не успеем. Ближайшая возможная — 18 ноября (EMS)»", async () => {
    await field.fill("2026-11-15");
    await expect(box.getByRole("status")).toHaveText("К этой дате не успеем. Ближайшая возможная — 18 ноября (EMS)");
    await expect(page.getByText("✓ Успеете")).toHaveCount(0);
    await expect(page.getByTestId("eta-ems")).toContainText("Не успеете");
  });

  await test.step("крестик: блок как раньше — подсказка, свёрнутый список, без плашек", async () => {
    await page.getByRole("button", { name: "Сбросить дату" }).click();
    await expect(box.getByText("Выберите дату")).toBeVisible();
    await expect(page.getByText(/Успеете/)).toHaveCount(0);
    await expect(box.getByRole("status")).toHaveCount(0);
    await expect(page.getByText("Сроки и цена других способов доставки")).toBeVisible();
  });

  await test.step("прошлая дата (браузер пропустил min) — неверная, плашек нет", async () => {
    await field.fill("2026-11-12");
    await expect(box.getByRole("alert")).toHaveText("Эта дата уже прошла — выберите другую.");
    await expect(page.getByText(/Успеете/)).toHaveCount(0);
  });
  expect(errors).toEqual([]);
});
