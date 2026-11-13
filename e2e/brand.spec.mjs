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
  // коллаж: фото с размерами, приоритет только у первого. N5: весь коллаж — первый экран, без ленивой загрузки;
  // пока фото грузится — подложка цвета поверхности (не белая)
  const imgs = hero.locator(".collage img");
  expect(await imgs.count()).toBeGreaterThanOrEqual(3);
  await expect(imgs.first()).toHaveAttribute("fetchpriority", "high");
  for (const i of [1, 2]) {
    await expect(imgs.nth(i)).toHaveAttribute("loading", "eager");
    await expect(imgs.nth(i)).not.toHaveAttribute("fetchpriority");
  }
  const under = await hero.locator(".collage picture").evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
  expect(under.every((c) => c !== "rgb(255, 255, 255)" && c !== "rgba(0, 0, 0, 0)")).toBe(true);
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

// Образцы всех плашек, кнопок и сообщений дизайн-системы — на странице в обеих темах; axe проверяет контраст AA
const SAMPLES = `
  <div id="ds-samples" style="padding:16px;display:flex;flex-wrap:wrap;gap:8px;background:var(--ds-color-bg-page)">
    <button class="btn btn-primary">Главная</button><button class="btn">Вторичная</button>
    <button class="btn btn-secondary">Контур</button><button class="btn-text">Текстовая</button>
    <span class="chip">Нейтральная</span><span class="chip chip-hl">В корзине</span><span class="chip chip-ok">TEST10</span>
    <span class="tag tag-new">новинка</span><span class="tag tag-sale">скидка</span><span class="tag tag-choice">выбор pic pac</span><span class="tag tag-180">180°</span>
    ${["accepted", "moderation", "production", "shipped", "done", "returned", "pending", "approved", "rejected", "draft", "in_cart", "ordered", "open", "answered", "closed"]
      .map((s) => `<span class="chip status-chip" data-status="${s}">${s}</span>`)
      .join("")}
    <p class="note">Сообщение</p><p class="note note-ok">Готово</p><p class="note note-warn"><span class="warn-text">Внимание</span></p><p class="note note-error"><span class="err-text">Ошибка</span></p>
    <p class="muted">Вторичный текст</p><a href="#ds-samples">Ссылка</a><span class="price-row"><s class="price-old">90,00 BYN</s><span class="price-now">от 81,00 BYN</span></span>
    <div class="card"><span class="eyebrow">Надзаголовок</span><p class="muted small">Подпись</p></div>
    <div class="segmented"><label><input type="radio" name="s" checked>Светлая</label><label><input type="radio" name="s">Тёмная</label></div>
  </div>`;

for (const theme of ["light", "dark"]) {
  test(`дизайн-система: контраст AA у кнопок, плашек и сообщений — ${theme === "light" ? "светлая" : "тёмная"} тема`, async ({ page }) => {
    const AxeBuilder = (await import("@axe-core/playwright")).default;
    if (theme === "dark") await page.context().addCookies([{ name: "pp_theme", value: "dark", url: test.info().project.use.baseURL }]);
    await page.goto("/help");
    // N5: под нагрузкой гидратация идёт и после networkidle — ждём, пока React «привяжет» main (свойство __reactFiber…)
    await page.waitForFunction(() => Object.keys(document.querySelector("main") || {}).some((k) => k.startsWith("__reactFiber")));
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", theme);
    // N2: образцы вставляем после гидратации — иначе React при гидратации main убирает чужие узлы (тест иногда падал)
    await page.waitForLoadState("networkidle");
    await page.evaluate((html) => document.querySelector("main").insertAdjacentHTML("afterbegin", html), SAMPLES);
    const r = await new AxeBuilder({ page }).include("#ds-samples").withRules(["color-contrast"]).analyze();
    const bad = r.violations.flatMap((v) => v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").pop()}`));
    expect(bad, bad.join("\n")).toEqual([]);
  });
}

// N7: у «Печати фото» нигде не пишем «книга» — шаги редактора и тост при уходе из редактора
test("печать фото: в редакторе и после ухода из него нет слова «книга»", async ({ page }) => {
  test.slow();
  const noBook = async (where) => {
    const txt = (await page.locator("main").innerText()).replace(/Мои книги/g, "");
    expect(txt, where).not.toMatch(/[Кк]ниг/);
  };
  await page.goto("/product/photo");
  await noBook("страница продукта");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["nesvizh-small", "cat-dark"]) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 2 фото" }).click();
  await expect(page.locator(".photo-cell img")).toHaveCount(2, { timeout: 120_000 });
  await noBook("шаг «Фото»");
  for (const step of ["Автомакет", "Правки", "Проверка"]) {
    await page.getByRole("button", { name: step, exact: true }).click();
    await page.waitForTimeout(800);
    await noBook(`шаг «${step}»`);
  }
  await page.waitForTimeout(400); // черновик пишется в IndexedDB
  await page.getByRole("link", { name: "PicPac — на главную" }).click();
  await expect(page.locator(".toast", { hasText: "Фото сохранены" })).toBeVisible();
  await expect(page.locator(".toast", { hasText: /[Кк]ниг/ })).toHaveCount(0);
});
