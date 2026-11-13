// День 3: доступность новых блоков — полоса «до бесплатной доставки» в корзине (задача 1) и «Нужно к дате»
// на странице товара (задача 2). axe, WCAG 2.x A/AA: в новых блоках 0 нарушений любой важности, на странице —
// 0 серьёзных и критических; цели касания новых блоков ≥ 44×44. Светлая и тёмная тема, телефон и компьютер.
// Пользователь e2e-…@example.com и корзина создаются и удаляются тестом.
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";
import { smallTargets } from "./helpers.mjs";

const JPEG = readFileSync(new URL("../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
let admin;
let user;

test.afterEach(async () => {
  if (user) await deleteTestUser(admin, user);
  user = null;
});

async function theme(page, scheme) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.context().addCookies([{ name: "pp_theme", value: scheme, url: test.info().project.use.baseURL }]);
}

async function axe(page, name, block) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(700);
  const all = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = all.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const fmt = (list) => list.map((v) => `${name}: ${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`).join("\n");
  expect(bad, fmt(bad)).toEqual([]);
  const own = await new AxeBuilder({ page }).include(block).withTags(TAGS).analyze();
  expect(own.violations, fmt(own.violations)).toEqual([]);
}

for (const scheme of ["light", "dark"]) {
  const label = scheme === "light" ? "светлая" : "тёмная";

  test(`корзина: полоса «до бесплатной доставки», ${label} тема`, async ({ page }, info) => {
    admin = supabaseAdmin();
    user = await createTestUser(admin, ["client"], "d3a" + info.parallelIndex + Date.now().toString(36).slice(-4));
    const p = await user.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "Осень", options: { size: "20x20", pages: 20 } } });
    const u = await user.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
    await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
    await user.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
    await user.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: p.json.project.id, quantity: 1 }] } });
    await theme(page, scheme);
    await page.goto("/login?next=/cart");
    await page.getByLabel("Почта").fill(user.email);
    await page.getByLabel("Пароль", { exact: true }).fill(user.password);
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await page.waitForURL(/\/cart/);
    await expect(page.getByTestId("free-delivery-text")).toHaveText(/осталось 69,00 BYN/);
    await axe(page, `корзина, осталось (${label})`, "[data-testid=free-delivery]");
    // 4 экземпляра — «✓ Доставка EMS бесплатна», полоса в «успешном» цвете
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Больше", exact: true }).click();
    await expect(page.getByTestId("free-delivery-text")).toHaveText("✓ Доставка EMS бесплатна");
    await axe(page, `корзина, бесплатно (${label})`, "[data-testid=free-delivery]");
  });

  test(`товар: «Нужно к дате», ${label} тема`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-13T10:00:00+03:00"));
    await theme(page, scheme);
    await page.goto("/product/layflat", { waitUntil: "load" });
    const field = page.getByLabel("Нужно к дате");
    await expect(page.getByTestId("need-by").getByText("Выберите дату")).toBeVisible();
    await axe(page, `товар, без даты (${label})`, "[data-testid=need-by]");
    await field.fill("2026-11-18");
    await expect(page.getByTestId("eta-ems")).toContainText("Успеете");
    await axe(page, `товар, 18 ноября (${label})`, ".product-aside");
    await field.fill("2026-11-15");
    await expect(page.getByTestId("need-by").getByRole("status")).toBeVisible();
    await axe(page, `товар, 15 ноября (${label})`, ".product-aside");
    const small = (await smallTargets(page)).filter((t) => /Сбросить дату|Нужно к дате/.test(t));
    expect(small, "цели касания «Нужно к дате» меньше 44×44").toEqual([]);
  });
}
