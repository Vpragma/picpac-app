// Доступность экранов N8 (axe, WCAG 2.x A/AA; 0 серьёзных и критических; цели касания ≥ 44×44):
// корзина с ошибкой промокода и применённым кодом, «Заказ оформлен» с открыткой, «Мои заказы» с кодом,
// админка «Промокоды» (таблица и форма с ошибками). Светлая и тёмная тема, телефон и компьютер.
// Пользователи e2e-…@example.com и заказ создаются и удаляются тестом.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";
import { smallTargets } from "./helpers.mjs";

const JPEG = readFileSync(new URL("../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
let admin;
let users = [];

test.afterEach(async () => {
  for (const u of users) {
    await admin.from("orders").delete().eq("user_id", u.id);
    await deleteTestUser(admin, u);
  }
  users = [];
});

async function axe(page, name) {
  // Сверху страницы: иначе axe считает «закрытыми» цели, оказавшиеся под липкой шапкой при прокрутке
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const report = bad.map((v) => `${name}: ${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(bad, report).toEqual([]);
  expect(await smallTargets(page), `${name}: цели касания меньше 44×44`).toEqual([]);
}

async function login(page, user, next) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

for (const scheme of ["light", "dark"]) {
  test(`промокоды и открытка, ${scheme === "light" ? "светлая" : "тёмная"} тема: нет серьёзных нарушений`, async ({ page }, info) => {
    admin = supabaseAdmin();
    const tag = info.parallelIndex + Date.now().toString(36).slice(-4);
    const [client, adm] = await Promise.all([createTestUser(admin, ["client"], "n8ax" + tag), createTestUser(admin, ["admin"], "n8axa" + tag)]);
    users = [client, adm];
    const p = await client.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { size: "20x20", pages: 20 } } });
    const u = await client.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
    await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
    await client.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
    await client.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });

    if (scheme === "dark") await page.context().addCookies([{ name: "pp_theme", value: "dark", url: info.project.use.baseURL }]);
    await login(page, client, "/cart");
    await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme);
    await expect(page.getByText("Фотокнига Classic").first()).toBeVisible();
    const promo = page.getByRole("textbox", { name: "Промокод" });
    await promo.fill("LETO2025");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(page.getByTestId("promo-msg")).toHaveText(/^Истёк/);
    await axe(page, "корзина: ошибка кода");
    await promo.fill("TEST10");
    await page.getByRole("button", { name: "Применить", exact: true }).click();
    await expect(page.getByTestId("promo-applied")).toBeVisible();
    await axe(page, "корзина: код применён");

    await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
    await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
    await page.locator('input[name="delivery"]').first().check();
    await page.locator("#f-pickup_point").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page.getByTestId("postcard")).toBeVisible({ timeout: 120_000 });
    await axe(page, "заказ оформлен: открытка");
    await page.goto("/orders");
    await expect(page.getByTestId("order-card-code").first()).toBeVisible();
    await axe(page, "мои заказы: код открытки");

    await page.context().clearCookies();
    if (scheme === "dark") await page.context().addCookies([{ name: "pp_theme", value: "dark", url: info.project.use.baseURL }]);
    await login(page, adm, "/admin/promo");
    await page.goto("/admin/promo");
    await expect(page.getByTestId("promo-table")).toBeVisible();
    await axe(page, "админка: промокоды");
    await page.getByRole("button", { name: "Новый промокод" }).click();
    await page.getByRole("button", { name: "Сохранить" }).click();
    await expect(page.locator(".promo-form .note-error")).toBeVisible();
    await axe(page, "админка: форма с ошибками");
  });
}
