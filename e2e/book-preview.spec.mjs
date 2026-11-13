// N11 · превью книги и шаблоны (гость; телефон 390×844 и компьютер 1280×800):
// обложка → развороты → задняя обложка; листание кнопками, стрелками клавиатуры и свайпом (телефон, настоящие касания);
// «Посмотреть книгу целиком» (иконка «180°»): диалог, фокус внутри, Esc закрывает, фокус возвращается на кнопку;
// шаблон «Осень» и вариант обложки: автомакет учитывает поля шаблона, выбор переживает перезагрузку;
// prefers-reduced-motion — без анимации. Что шаблон попадает в заказ — tests/api/book.test.mjs (снимок заказа).
import { expect, test } from "@playwright/test";

const steps = (page) => page.getByRole("navigation", { name: "Шаги редактора" });
const inline = (page) => page.locator(".bk-wrap > .bk-controls [data-testid=book-position]");

async function bookWithPhotos(page, n = 5) {
  await page.goto("/product/layflat");
  await page.getByRole("button", { name: "Создать фотокнигу" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  const boxes = gallery.locator("label[data-file] input[type=checkbox]");
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await gallery.getByRole("button", { name: `Добавить ${n} фото` }).click();
  await expect(page.locator(".photo-cell img")).toHaveCount(n, { timeout: 120_000 });
  await steps(page).getByRole("button", { name: "Автомакет" }).click();
  await expect(page.locator(".bk-wrap")).toBeVisible();
  await expect(inline(page)).toHaveText("Обложка");
}

// Настоящий свайп пальцем (Chrome DevTools Protocol): касание, движение, отпускание
async function swipe(page, dir) {
  const box = await page.locator(".bk-wrap .bk-stage").boundingBox();
  const cdp = await page.context().newCDPSession(page);
  const y = Math.round(box.y + box.height / 2);
  const from = Math.round(box.x + box.width * (dir < 0 ? 0.8 : 0.2));
  const to = Math.round(box.x + box.width * (dir < 0 ? 0.2 : 0.8));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: Math.round(from + ((to - from) * i) / 6), y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return errors;
}

test("превью книги: обложка и развороты, кнопки, стрелки, свайп; «180°» — на весь экран", async ({ page }) => {
  const errors = watchErrors(page);
  await bookWithPhotos(page, 5);

  await test.step("обложка по центру; «Вперёд» — 3D-перелистывание до разворота 1 из 10", async () => {
    await expect(page.locator(".bk-wrap .bk-book")).toHaveAttribute("data-view", "0");
    await expect(page.locator(".bk-wrap .bk-cover")).toBeVisible();
    await page.getByRole("button", { name: "Вперёд: следующий разворот" }).click();
    await expect(inline(page)).toHaveText("Разворот 1 из 10");
    await expect(page.locator(".bk-wrap .bk-leaf")).toHaveCount(0, { timeout: 5_000 }); // лист лёг на место
    await expect(page.locator(".bk-wrap .bk-left .bk-slot img")).toHaveCount(1);
    await expect(page.locator(".bk-wrap .bk-right .bk-slot img")).toHaveCount(1);
    await expect(page.locator(".bk-wrap .bk-count")).toContainText("стр. 1 и 2");
  });

  await test.step("клавиатура: стрелки вправо и влево, Home — к обложке", async () => {
    await page.locator(".bk-wrap .bk-frame").focus();
    await page.keyboard.press("ArrowRight");
    await expect(inline(page)).toHaveText("Разворот 2 из 10");
    await page.keyboard.press("ArrowLeft");
    await expect(inline(page)).toHaveText("Разворот 1 из 10");
    await page.keyboard.press("End");
    await expect(inline(page)).toHaveText("Задняя обложка");
    await expect(page.getByRole("button", { name: "Вперёд: следующий разворот" })).toBeDisabled();
    await page.keyboard.press("Home");
    await expect(inline(page)).toHaveText("Обложка");
    await expect(page.getByRole("button", { name: "Назад: предыдущий разворот" })).toBeDisabled();
  });

  if (test.info().project.use.hasTouch) {
    await test.step("телефон: свайп влево — вперёд, вправо — назад", async () => {
      await page.locator(".bk-wrap").scrollIntoViewIfNeeded();
      await swipe(page, -1);
      await expect(inline(page)).toHaveText("Разворот 1 из 10");
      await expect(page.locator(".bk-wrap .bk-leaf")).toHaveCount(0, { timeout: 5_000 });
      await swipe(page, -1);
      await expect(inline(page)).toHaveText("Разворот 2 из 10");
      await expect(page.locator(".bk-wrap .bk-leaf")).toHaveCount(0, { timeout: 5_000 });
      await swipe(page, 1);
      await expect(inline(page)).toHaveText("Разворот 1 из 10");
    });
  } else {
    await test.step("компьютер: кнопки «Вперёд» и «Назад»", async () => {
      await page.getByRole("button", { name: "Вперёд: следующий разворот" }).click();
      await expect(inline(page)).toHaveText("Разворот 1 из 10");
    });
  }

  await test.step("«Посмотреть книгу целиком»: диалог, фокус внутри, стрелки, Esc, фокус возвращается", async () => {
    const open = page.getByRole("button", { name: "Посмотреть книгу целиком" });
    await expect(open.locator("svg")).toHaveCount(1); // иконка «180°»
    await open.click();
    const dialog = page.getByRole("dialog", { name: "Книга целиком" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Закрыть" })).toBeFocused();
    await expect(dialog.locator("[data-testid=book-position]")).toHaveText("Разворот 1 из 10");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator("[data-testid=book-position]")).toHaveText("Разворот 2 из 10");
    // Tab не уводит фокус за пределы диалога
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    await expect(inline(page)).toHaveText("Разворот 2 из 10"); // превью и полный экран — один и тот же разворот
  });

  await test.step("«назад» браузера закрывает книгу на весь экран и остаётся в редакторе; после «Закрыть» лишней записи нет (N7 D3)", async () => {
    const open = page.getByRole("button", { name: "Посмотреть книгу целиком" });
    const dialog = page.getByRole("dialog", { name: "Книга целиком" });
    const url = page.url();
    await open.click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(url);
    await expect(page.locator(".bk-wrap")).toBeVisible();
    await open.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Закрыть" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => page.evaluate(() => !!window.history.state?.bkFull)).toBe(false);
    expect(page.url()).toBe(url);
  });

  await test.step("клавиатура после кнопок: стрелки листают и после «Вперёд», фокус не падает на <body> (N7 D6)", async () => {
    await page.getByRole("button", { name: "Вперёд: следующий разворот" }).click();
    await expect(inline(page)).toHaveText("Разворот 3 из 10");
    await page.keyboard.press("ArrowRight");
    await expect(inline(page)).toHaveText("Разворот 4 из 10");
    await page.keyboard.press("End");
    await expect(inline(page)).toHaveText("Задняя обложка");
    await expect(page.locator(".bk-wrap .bk-frame")).toBeFocused(); // кнопка «Вперёд» заблокирована — фокус на книге, не на <body>
    await page.keyboard.press("ArrowLeft");
    await expect(inline(page)).toHaveText("Разворот 10 из 10");
  });

  expect(errors, errors.join("\n")).toEqual([]);
});

test("обложка: название до 40 знаков целиком во всех вариантах и пропорциях страниц, без обрезки (N7 D1)", async ({ page }) => {
  const errors = watchErrors(page);
  await bookWithPhotos(page, 2);
  const titleBox = page.getByRole("textbox", { name: "Название", exact: true });
  await page.getByRole("textbox", { name: "Дата", exact: true }).fill("август 2026");
  // текст не обрезан: scrollHeight ≤ clientHeight у места под текст, слова не вылезают по ширине
  const fits = () =>
    page.locator(".bk-wrap .bk-cover-text").evaluate((el) => {
      const parts = [...el.querySelectorAll(".bk-cover-title, .bk-cover-date")];
      return el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1 && parts.every((x) => x.scrollWidth <= x.clientWidth + 1);
    });
  const titles = ["Лето у бабушки в Несвиже 2026", "Наше большое лето у бабушки в Несвиже 26", "Достопримечательности Несвижского замка", "Я".repeat(40)];
  for (const title of titles) {
    await titleBox.fill(title);
    for (const layout of ["photo", "full", "title"]) {
      await page.locator(`.bk-pick-item[data-cover=${layout}] input`).check();
      await expect(page.locator(".bk-wrap .bk-cover .bk-cover-title")).toHaveText(title);
      // пропорции разворота форматов каталога: 20×20, 30×20, 20×30, 15×20, 30×30-широкий
      for (const ar of [2, 3, 4 / 3, 1.5, 2.6]) {
        await page.locator(".bk-wrap .bk-stage").evaluate((el, a) => el.style.setProperty("--bk-ar", String(a)), ar);
        await expect.poll(fits, { message: `«${layout}», ${title.length} знаков, разворот ${ar.toFixed(2)}` }).toBe(true);
      }
    }
  }
  expect(errors, errors.join("\n")).toEqual([]);
});

test("шаблон «Осень» и обложка: поля автомакета, превью, выбор на месте после перезагрузки", async ({ page }) => {
  const errors = watchErrors(page);
  await bookWithPhotos(page, 3);
  const leftSlot = page.locator(".bk-wrap .bk-left .bk-slot").first();

  await test.step("«Классика» → поля 6 %, «Осень» → 10 % и осенняя палитра", async () => {
    await page.getByRole("radio", { name: /^Классика/ }).check();
    await page.getByRole("button", { name: "Вперёд: следующий разворот" }).click();
    await expect(inline(page)).toHaveText("Разворот 1 из 10");
    await expect(leftSlot).toHaveAttribute("style", /left: 6%/);
    await page.getByRole("radio", { name: /^Осень/ }).check();
    await expect(page.locator(".bk-wrap")).toHaveAttribute("data-template", "autumn");
    await expect(leftSlot).toHaveAttribute("style", /left: 10%/);
    await expect(page.locator(".bk-wrap .bk-left .bk-page")).toHaveClass(/season-palette-autumn/);
  });

  await test.step("обложка: название, дата, «Только название» — видно в превью", async () => {
    await page.getByRole("textbox", { name: "Название", exact: true }).fill("Осень у бабушки");
    await page.getByRole("textbox", { name: "Дата", exact: true }).fill("октябрь 2026");
    await page.getByRole("radio", { name: "Только название" }).check();
    await page.getByRole("button", { name: "Назад: предыдущий разворот" }).click();
    await expect(inline(page)).toHaveText("Обложка");
    const cover = page.locator(".bk-wrap .bk-cover");
    await expect(cover).toHaveAttribute("data-cover-layout", "title");
    await expect(cover.locator(".bk-cover-title")).toHaveText("Осень у бабушки");
    await expect(cover.locator(".bk-cover-date")).toHaveText("октябрь 2026");
    // длина названия — в знаках, которые видит человек: семья 👨‍👩‍👧 — один знак и не распадается (N7 D7)
    const titleBox = page.getByRole("textbox", { name: "Название", exact: true });
    const fam = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}";
    await titleBox.fill("Мы " + fam);
    await expect(titleBox).toHaveValue("Мы " + fam);
    await expect(page.getByText("4 из 40 знаков")).toBeVisible();
    await titleBox.fill("🍂".repeat(45));
    await expect(titleBox).toHaveValue("🍂".repeat(40));
    await expect(page.getByText("40 из 40 знаков")).toBeVisible();
    await titleBox.fill("Осень у бабушки");
    await expect(cover.locator(".bk-cover-title")).toHaveText("Осень у бабушки");
  });

  await test.step("перезагрузка: шаблон, обложка и вариант — те же", async () => {
    await page.waitForTimeout(500); // черновик пишется в IndexedDB
    await page.reload();
    await steps(page).getByRole("button", { name: "Автомакет" }).click();
    await expect(page.getByRole("radio", { name: /^Осень/ })).toBeChecked();
    await expect(page.getByRole("radio", { name: "Только название" })).toBeChecked();
    await expect(page.getByRole("textbox", { name: "Название", exact: true })).toHaveValue("Осень у бабушки");
    await expect(page.getByRole("textbox", { name: "Дата", exact: true })).toHaveValue("октябрь 2026");
    await expect(page.locator(".bk-wrap .bk-cover .bk-cover-title")).toHaveText("Осень у бабушки");
  });

  expect(errors, errors.join("\n")).toEqual([]);
});

test("prefers-reduced-motion: листается сразу, без анимации", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await bookWithPhotos(page, 2);
  await page.getByRole("button", { name: "Вперёд: следующий разворот" }).click();
  await expect(inline(page)).toHaveText("Разворот 1 из 10");
  await expect(page.locator(".bk-wrap .bk-leaf")).toHaveCount(0);
  // Движение — анимации длиннее 1 мс. Глобальное правило reduce (motion.css) даёт любому изменению стиля переход 0,01 мс
  // (например, тень у левой страницы, когда она перестаёт быть пустой) — это не движение, но в getAnimations() он виден
  // один кадр; раньше тест из-за этого иногда падал. Перелистывание (650 мс) и сдвиг книги (650 мс) этот фильтр ловит.
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.closest?.(".bk-wrap") && Number(a.effect.getComputedTiming().duration) > 1).length);
  expect(running).toBe(0);
  const dur = await page.locator(".bk-wrap .bk-book").evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration));
  expect(dur).toBeLessThan(0.01);
});
