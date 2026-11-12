// D6: облачный ИИ в редакторе.
// Гость: сложная команда → подсказка «работает после входа», «убери машину» → просьба коснуться; запросов к /api/v1/ai/* нет.
// Вошедший (только если сервер запущен с AI_CLOUD_FAKE=1 — живое облако в e2e не вызываем): сложная команда →
// карточка согласия → «Разрешить» → шаги облака применены (ползунки); второй раз согласие не спрашивается.
// Пользователь e2e-…@example.com удаляется после теста.
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

async function openEditorWithPhoto(page) {
  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  await gallery.locator('label:has(img[src="/demo-gallery/mir-castle.jpg"]) input[type=checkbox]').check();
  await gallery.getByRole("button", { name: "Добавить 1 фото" }).click();
  await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(1);
  await page.getByRole("button", { name: "Правки", exact: true }).click();
  await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);
}

async function say(page, text) {
  const cmd = page.locator("#pe-cmd");
  await cmd.fill(text);
  await cmd.press("Enter");
}

function watch(page) {
  const errors = [];
  const aiCalls = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("request", (r) => r.url().includes("/api/v1/ai/") && aiCalls.push(r.method() + " " + new URL(r.url()).pathname));
  return { errors, aiCalls };
}

test("гость: облачный ИИ не вызывается, понятные подсказки и откат на касание", async ({ page }) => {
  const w = watch(page);
  await openEditorWithPhoto(page);
  await say(page, "сделай как в старом кино");
  await expect(page.locator(".pe-answer")).toContainText("облачный ИИ — он работает после входа");
  await say(page, "убери машину");
  await expect(page.locator(".pe-answer")).toContainText("Коснитесь того, что убрать");
  expect(w.aiCalls).toEqual([]);
  expect(w.errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
});

test.describe("вошедший клиент", () => {
  let admin;
  let user;
  test.beforeEach(async ({}, info) => {
    admin = supabaseAdmin();
    user = await createTestUser(admin, ["client"], "e2ecloud" + info.parallelIndex + Date.now().toString(36).slice(-4));
  });
  test.afterEach(async () => {
    if (user) await deleteTestUser(admin, user);
    user = null;
  });

  test("согласие один раз, свободная команда через облако (подмена)", async ({ page }) => {
    const w = watch(page);
    await page.goto("/login");
    await page.getByLabel("Почта").fill(user.email);
    await page.getByLabel("Пароль", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    const st = await page.evaluate(() => fetch("/api/v1/ai/cloud").then((r) => r.json()));
    test.skip(!st.fake, "сервер без AI_CLOUD_FAKE=1 — живое облако в e2e не вызываем");

    await openEditorWithPhoto(page);
    await say(page, "сделай как в старом кино");
    const card = page.locator("[data-cloud-consent]");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Фото отправится в Cloudflare для обработки и не сохраняется.");
    await card.getByRole("button", { name: "Разрешить" }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator(".pe-answer")).toContainText("Облачный ИИ:");
    await expect(page.getByRole("slider", { name: "Насыщенность" })).toHaveValue("-30");

    // Второй раз согласие не спрашивается
    await say(page, "сделай как в старом кино");
    await expect(page.locator(".pe-answer")).toContainText("Облачный ИИ:");
    await expect(card).toHaveCount(0);
    expect(w.aiCalls.filter((c) => c.endsWith("/ai/consent"))).toEqual(["POST /api/v1/ai/consent"]);
    expect(w.errors.filter((e) => !/Failed to load resource/.test(e))).toEqual([]);
  });
});
