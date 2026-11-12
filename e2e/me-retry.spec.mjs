// Критик S02, круг 2: сбой GET /api/v1/me сразу после входа не должен оставлять гостевую корзину на устройстве
// и гонять по кругу /cart ↔ /login. Первый ответ /me после входа подменяем на 503 — корзина всё равно
// переезжает в аккаунт (повтор /me с отсрочкой → режим клиента), адрес остаётся /cart, консоль без ошибок JS.
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

let admin;
let user;

test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  user = await createTestUser(admin, ["client"], "me" + info.parallelIndex + Date.now().toString(36).slice(-4));
});

test.afterEach(async () => {
  if (!user) return;
  await deleteTestUser(admin, user);
  user = null;
});

test("сбой GET /me после входа: корзина переносится в аккаунт без круга /cart ↔ /login", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/product/photopaper-book");
  await page.getByRole("button", { name: "Создать фотокнигу" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["mir-castle", "nesvizh"]) await gallery.locator(`label:has(img[src="/demo-gallery/${f}.jpg"]) input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 2 фото" }).click();
  await expect(page.locator(".photo-cell img")).toHaveCount(2, { timeout: 60_000 });

  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
  const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
  for (let i = 0; i < 6 && (await toCart.isDisabled()); i++) {
    const fit = page.getByRole("button", { name: /^Сделать \d+ стр\.$/ }).first();
    const all = page.getByRole("button", { name: /^Продолжить всё равно для всех/ });
    const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
    if (await fit.isVisible().catch(() => false)) await fit.click();
    else if (await all.isVisible().catch(() => false)) await all.click();
    else if (await go.isVisible().catch(() => false)) await go.click();
  }
  await toCart.click();
  await expect(page).toHaveURL(/\/cart/);

  // Гость заполняет обязательные поля до входа (баг 6: иначе вход, а потом незаполненная форма)
  await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
  await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
  await page.locator('input[name="delivery"]').first().check();
  await page.locator("#f-pickup_point").selectOption({ index: 1 });
  await page.locator('input[name="payment"]').nth(1).check();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page).toHaveURL(/\/login\?reason=checkout/);

  // После входа первый GET /me отвечает 503 (сбой сервера), дальше — как обычно
  let failed = 0;
  await page.route("**/api/v1/me", async (route) => {
    if (route.request().method() === "GET" && failed === 0) {
      failed += 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "unavailable", message: "Сбой" } }) });
    }
    return route.continue();
  });
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect.poll(() => failed, { timeout: 15_000 }).toBe(1);

  // Корзина уехала в аккаунт, страница не ушла на вход
  await expect.poll(async () => (await user.client.req("/api/v1/cart")).json?.cart?.items?.length, { timeout: 90_000 }).toBe(1);
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByText(/Чтобы подтвердить заказ, войдите/)).toHaveCount(0);
  expect(errors).toEqual([]);
});
