// N8 e2e: корзина с промокодом → понятные ошибки («истёк», «минимальная сумма») → скидка в итоге → заказ →
// открытка с личным кодом (сохраняется картинкой PNG на устройстве) → код виден в «Мои заказы», второй не создаётся.
// Телефон 390×844 и компьютер 1280×800. Пользователь e2e-…@example.com, проект и корзина создаются через API,
// тестовый код E2E… — сервисным ключом; всё удаляется после теста.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const JPEG = readFileSync(new URL("../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
let admin;
let user;
let code;

test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  user = await createTestUser(admin, ["client"], "n8e" + info.parallelIndex + Date.now().toString(36).slice(-4));
  code = "E2E" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const { error } = await admin.from("promo_codes").insert({ code, kind: "percent", value: 20, label: "−20% для проверки", active: true, is_synthetic: true });
  if (error) throw new Error(error.message);
  // Корзина на сервере: Classic 20×20, 20 страниц — 81,00 BYN
  const p = await user.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Осень", options: { size: "20x20", pages: 20 } } });
  const u = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  await user.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  const cart = await user.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
  if (cart.json?.cart?.goodsKop !== 8100) throw new Error("корзина не собралась: " + cart.text);
});

test.afterEach(async () => {
  if (user) {
    await admin.from("orders").delete().eq("user_id", user.id);
    await deleteTestUser(admin, user);
  }
  if (code) await admin.from("promo_codes").delete().eq("code", code);
  user = null;
});

test("промокод в корзине → заказ → открытка с личным кодом → «Мои заказы»", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  await page.goto("/login?next=/cart");
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(/\/cart/);
  await expect(page.getByText("Фотокнига Classic").first()).toBeVisible();

  const promo = page.getByRole("textbox", { name: "Промокод" });
  const apply = page.getByRole("button", { name: "Применить", exact: true });
  const msg = page.getByTestId("promo-msg");

  await test.step("понятные ошибки: истёк, минимальная сумма, не для этого продукта", async () => {
    await promo.fill("LETO2025");
    await apply.click();
    await expect(msg).toHaveText(/^Истёк: промокод действовал до 31 августа 2025/);
    await expect(msg).toHaveClass(/note-error/);
    // N7: Enter в поле (на телефоне — «Go») тоже применяет код
    await promo.fill("BIGBOOK30");
    await promo.press("Enter");
    await expect(msg).toHaveText(/минимальная сумма заказа .*200,00 BYN/);
    await promo.fill("NOSUCH42");
    await apply.click();
    await expect(msg).toHaveText(/^Не подходит: такого промокода нет/);
  });

  await test.step("код применён — скидка видна в итоге", async () => {
    await promo.fill(code.toLowerCase());
    await promo.press("Enter");
    await expect(page.getByTestId("promo-applied")).toContainText(code);
    await expect(msg).toHaveClass(/note-ok/);
    await expect(page.getByTestId("sum-discount")).toContainText(`по коду ${code}`);
    await expect(page.getByTestId("sum-discount")).toContainText("−16,20 BYN");
  });

  await test.step("получатель, доставка, оплата → «Заказ оформлен»", async () => {
    await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
    await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
    await page.locator('input[name="delivery"]').first().check();
    await page.locator("#f-pickup_point").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page.getByRole("heading", { name: "Заказ оформлен" })).toBeVisible({ timeout: 120_000 });
  });

  let card;
  await test.step("открытка с личным кодом; сохраняется картинкой PNG", async () => {
    const pc = page.getByTestId("postcard");
    await expect(pc).toBeVisible();
    card = await pc.getAttribute("data-code");
    expect(card).toMatch(/^PP[A-Z0-9]{8}$/);
    await expect(pc.getByRole("img")).toHaveAttribute("aria-label", new RegExp(`${card}.*−10%.*действует до`));
    const [download] = await Promise.all([page.waitForEvent("download"), pc.getByRole("button", { name: "Сохранить картинкой" }).click()]);
    expect(download.suggestedFilename()).toBe(`picpac-otkrytka-${card}.png`);
    const file = await download.path();
    const png = readFileSync(file);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(20_000);
    await expect(pc.getByText("Открытка сохранена картинкой.")).toBeVisible();
  });

  await test.step("«Мои заказы»: код виден, повторный показ не создаёт второй", async () => {
    await page.goto("/orders");
    await expect(page.getByTestId("order-card-code").first()).toContainText(card);
    await page.reload();
    await expect(page.getByTestId("order-card-code").first()).toContainText(card);
    const { data } = await admin.from("promo_codes").select("code").eq("owner_user_id", user.id);
    expect(data.map((r) => r.code)).toEqual([card]);
    await page.getByRole("link", { name: /Открыть заказ/ }).first().click();
    await expect(page.getByTestId("postcard")).toHaveAttribute("data-code", card);
  });

  expect(errors, errors.join("\n")).toEqual([]);
});
