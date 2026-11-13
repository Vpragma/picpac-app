// День 3, задача 1: полоса «до бесплатной доставки» в корзине. Телефон 390×844 и компьютер 1280×800.
// Classic 20×20, 20 страниц = 81,00 BYN: 1 шт. — «осталось 69,00», 2 шт. — Белпочта бесплатна, с кодом −10 % —
// снова платная (полоса и строка «Доставка» согласованы), 4 шт. — EMS бесплатна; корзина пустая — блока нет.
// Пользователь e2e-…@example.com, проект, корзина и код E2E… создаются через API и удаляются после теста.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const JPEG = readFileSync(new URL("../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
let admin;
let user;
let code;

async function cartWith(quantity) {
  const p = await user.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Осень", options: { size: "20x20", pages: 20 } } });
  const u = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  await user.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  const cart = await user.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity }] } });
  if (cart.json?.cart?.goodsKop !== 8100 * quantity) throw new Error("корзина не собралась: " + cart.text);
}

async function login(page) {
  await page.goto("/login?next=/cart");
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL(/\/cart/);
  await expect(page.getByText("Фотокнига Classic").first()).toBeVisible();
}

test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  user = await createTestUser(admin, ["client"], "fd" + info.parallelIndex + Date.now().toString(36).slice(-4));
  code = "E2E" + randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
  const { error } = await admin.from("promo_codes").insert({ code, kind: "percent", value: 10, label: "−10% для проверки", active: true, is_synthetic: true });
  if (error) throw new Error(error.message);
});

test.afterEach(async () => {
  if (user) {
    await admin.from("orders").delete().eq("user_id", user.id);
    await deleteTestUser(admin, user);
  }
  if (code) await admin.from("promo_codes").delete().eq("code", code);
  user = null;
});

test("полоса: 81 → 162 BYN, Белпочта; с кодом −10 % полоса и «Доставка» снова платные", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await cartWith(1);
  await login(page);
  const block = page.getByTestId("free-delivery");
  const text = page.getByTestId("free-delivery-text");
  const bar = block.getByRole("progressbar", { name: "До бесплатной доставки" });
  const deliveryLine = page.locator(".sum-line", { hasText: /^Доставка/ });

  await expect(text).toHaveText("До бесплатной доставки Белпочтой осталось 69,00 BYN");
  await expect(bar).toHaveAttribute("aria-valuenow", "54");

  await test.step("+1 экземпляр — пересчёт сразу: Белпочта бесплатна, до EMS 138,00", async () => {
    await page.getByRole("button", { name: "Больше", exact: true }).click();
    await expect(text).toHaveText("Доставка Белпочтой бесплатна. До бесплатной EMS осталось 138,00 BYN");
    await page.getByRole("radio", { name: /^Белпочта,/ }).check();
    await expect(deliveryLine).toContainText("бесплатно");
  });

  await test.step("код −10 %: 145,80 BYN — до бесплатной Белпочты 4,20, «Доставка» 6,90 BYN", async () => {
    await page.getByRole("textbox", { name: "Промокод" }).fill(code);
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(page.getByTestId("sum-discount")).toContainText("−16,20 BYN");
    await expect(text).toHaveText("До бесплатной доставки Белпочтой осталось 4,20 BYN");
    await expect(deliveryLine).toContainText("6,90 BYN");
  });
  expect(errors).toEqual([]);
});

test("полоса: 324 BYN — «✓ Доставка EMS бесплатна», полная; пустая корзина — блока нет", async ({ page }) => {
  await cartWith(4);
  await login(page);
  const block = page.getByTestId("free-delivery");
  await expect(page.getByTestId("free-delivery-text")).toHaveText("✓ Доставка EMS бесплатна");
  await expect(block).toHaveAttribute("data-state", "done");
  await expect(block.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");

  await page.getByRole("button", { name: /^Убрать из корзины/ }).click();
  await expect(page.getByTestId("free-delivery")).toHaveCount(0);
});
