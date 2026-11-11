// ИИ-редактор фото, S03a–b (гость, телефон 390×844 и компьютер 1280×800):
// анализ при добавлении → значки «Темно»/«Пересвет»/«Улучшено», хорошее фото без значков;
// автоулучшение и его отмена (на одном фото и «Отменить все улучшения»); команда «сделай ярче» → значок «ИИ»;
// непонятная команда → подсказка; «До / после» (ползунок и удержание); правки переживают перезагрузку;
// «Вернуть оригинал».
import { expect, test } from "@playwright/test";

// Средняя яркость canvas (0…255): «после» — .pe-after, «до» — .pe-before
const mean = (page, sel) =>
  page.evaluate((s) => {
    const c = document.querySelector(s);
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  }, sel);

const badgesOf = (page, file) => page.locator(`.photo-cell[data-photo="${file}"] .pe-badge`).allTextContents();
const stripBadges = (page, file) => page.locator(`[data-edit-photo="${file}"] .pe-badge`).allTextContents();
const mainBadges = (page) => page.locator(".pe-main .pe-name + .pe-badges .pe-badge").allTextContents();

async function waitRendered(page) {
  await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);
}

test("ИИ-редактор: анализ, автоулучшение и отмена, команды, до/после, перезагрузка", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await test.step("гость: печать фото → тестовая галерея (тёмное, пересвеченное, хорошее)", async () => {
    await page.goto("/product/photo");
    await page.getByRole("button", { name: "Выбрать фото" }).click();
    await expect(page).toHaveURL(/\/editor/);
    await page.getByRole("button", { name: "Тестовая галерея" }).click();
    const gallery = page.getByRole("region", { name: "Тестовая галерея" });
    await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
    await gallery.getByRole("button", { name: "Снять выбор" }).click();
    for (const f of ["cat-dark", "braslav-lake-bright", "mir-castle"]) await gallery.locator(`label:has(img[src="/demo-gallery/${f}.jpg"]) input[type=checkbox]`).check();
    await gallery.getByRole("button", { name: "Добавить 3 фото" }).click();
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(3);
  });

  await test.step("анализ в воркере: значки на миниатюрах, хорошее фото не тронуто", async () => {
    await expect.poll(() => badgesOf(page, "cat-dark.jpg"), { timeout: 60_000 }).toEqual(["Темно", "Улучшено"]);
    await expect.poll(() => badgesOf(page, "braslav-lake-bright.jpg")).toEqual(["Пересвет", "Улучшено"]);
    expect(await badgesOf(page, "mir-castle.jpg")).toEqual([]);
  });

  await test.step("«Правки»: тёмное фото улучшено — «после» светлее «до»; отмена и возврат улучшения", async () => {
    await page.getByRole("button", { name: "Правки", exact: true }).click();
    await page.locator('[data-edit-photo="cat-dark.jpg"]').click();
    await waitRendered(page);
    await expect.poll(() => mainBadges(page)).toEqual(["Темно", "Улучшено"]);
    const before = await mean(page, ".pe-before");
    const after = await mean(page, ".pe-after");
    expect(after).toBeGreaterThan(before + 20);

    await page.getByRole("button", { name: "Отменить улучшение" }).click();
    await expect.poll(() => mainBadges(page)).toEqual(["Темно"]);
    await expect.poll(async () => Math.abs((await mean(page, ".pe-after")) - before)).toBeLessThan(1);
    await page.getByRole("button", { name: "Вернуть улучшение" }).click();
    await expect.poll(() => mainBadges(page)).toEqual(["Темно", "Улучшено"]);
  });

  await test.step("команда «сделай ярче» — сразу светлее, значок «ИИ»; непонятная — подсказка", async () => {
    const was = await mean(page, ".pe-after");
    await page.getByLabel("Что изменить?").fill("сделай ярче");
    await page.getByRole("button", { name: "Сделать" }).click();
    await expect(page.locator(".pe-answer")).toHaveText(/Сделали ярче/);
    await expect.poll(() => mainBadges(page)).toContain("ИИ");
    await expect.poll(() => mean(page, ".pe-after")).toBeGreaterThan(was + 3);
    await expect(page.getByRole("slider", { name: "Яркость" })).toHaveValue("20");

    await page.getByLabel("Что изменить?").fill("абракадабра");
    await page.getByRole("button", { name: "Сделать" }).click();
    await expect(page.locator(".pe-answer")).toHaveText(/Не понял.*Попробуйте/);
    await page.getByRole("button", { name: "Теплее", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Тепло" })).toHaveValue("20");
    await page.getByRole("button", { name: "Отменить", exact: true }).click();
    await expect(page.getByRole("slider", { name: "Тепло" })).toHaveValue("0");
  });

  await test.step("«До / после»: ползунок и удержание", async () => {
    await expect(page.locator(".pe-tag.left")).toHaveCount(0);
    await page.getByRole("slider", { name: /До \/ после/ }).fill("50");
    await expect(page.locator(".pe-before")).toHaveCSS("clip-path", "inset(0px 50% 0px 0px)");
    await expect(page.locator(".pe-tag.left")).toHaveText("До");
    await page.getByRole("slider", { name: /До \/ после/ }).fill("0");
    const hold = page.getByRole("button", { name: "Удерживайте — оригинал" });
    await hold.hover();
    await page.mouse.down();
    await expect(page.locator(".pe-stage")).toHaveAttribute("data-compare", "100");
    await page.mouse.up();
    await expect(page.locator(".pe-stage")).toHaveAttribute("data-compare", "0");
  });

  await test.step("правки переживают перезагрузку; «Отменить все улучшения»; «Вернуть оригинал»", async () => {
    await page.waitForTimeout(400); // запись черновика в IndexedDB — не позже 0,15 с
    await page.reload();
    await page.getByRole("button", { name: "Правки", exact: true }).click();
    await expect.poll(() => stripBadges(page, "cat-dark.jpg")).toEqual(["Темно", "Улучшено", "ИИ"]);
    await page.locator('[data-edit-photo="cat-dark.jpg"]').click();
    await expect(page.getByRole("slider", { name: "Яркость" })).toHaveValue("20");

    await page.getByRole("button", { name: "Отменить все улучшения" }).click();
    await expect.poll(() => stripBadges(page, "braslav-lake-bright.jpg")).toEqual(["Пересвет"]);
    await expect.poll(() => stripBadges(page, "cat-dark.jpg")).toEqual(["Темно", "ИИ"]);

    await page.getByRole("button", { name: "Вернуть оригинал" }).click();
    await expect.poll(() => stripBadges(page, "cat-dark.jpg")).toEqual(["Темно"]);
    await waitRendered(page);
    await expect.poll(async () => Math.abs((await mean(page, ".pe-after")) - (await mean(page, ".pe-before")))).toBeLessThan(1);
  });

  expect(errors).toEqual([]);
});
