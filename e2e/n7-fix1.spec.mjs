// N7, круг 1: шапка всегда сверху (панель цены редактора не закрывает «Помощь» и «Корзину» при прокрутке),
// в меню админки подсвечен только текущий раздел (админ и модератор), лента статусов: пройденные — с галочкой,
// текущий — «сейчас» без галочки, будущие — бледные.
// Вход — свои тестовые night2-n7-…@example.com (создаются и удаляются тестом); для ленты статусов — демо-клиент
// (пароль из окружения, как в API-тестах), у него заказы во всех статусах.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";
import { ADMIN_SECTIONS } from "../lib/adminNav.js";

let admin;
let user;

async function login(page, roles) {
  admin = supabaseAdmin();
  const email = `night2-n7-e2e-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Night2 N7" } });
  if (error) throw new Error(error.message);
  user = { id: data.user.id, email };
  await admin.from("user_roles").delete().eq("user_id", user.id).eq("role", "client");
  for (const role of roles) await admin.from("user_roles").upsert({ user_id: user.id, role });
  const r = await page.request.post("/api/v1/auth/login", { data: { email, password } });
  expect(r.status()).toBe(200);
}

test.afterEach(async () => {
  if (user) await deleteTestUser(admin, user);
  user = null;
});

// Что лежит в центре кнопки: сама кнопка (или её значок) — значит, она сверху и нажимается
const onTop = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
  }, sel);

test("шапка сверху: при прокрутке редактора панель цены не закрывает «Помощь» и «Корзину»", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/product/photopaper-book");
  await page.getByRole("button", { name: "Создать фотокнигу" }).click();
  await expect(page).toHaveURL(/\/editor/);
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: /Добавить \d+ фото/ }).click();
  await expect(page.locator(".photo-cell[data-photo]").first()).toBeVisible({ timeout: 120_000 });
  // Шаг за шагом от верха: раньше на компьютере при прокрутке на 80–120 px панель вставала поверх шапки
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y <= Math.min(max, 600); y += 20) {
    await page.evaluate((yy) => scrollTo(0, yy), y);
    expect(await onTop(page, ".help-btn"), `«Помощь» сверху при прокрутке ${y}`).toBe(true);
    expect(await onTop(page, ".cart-btn"), `«Корзина» сверху при прокрутке ${y}`).toBe(true);
  }
  await page.evaluate(() => scrollTo(0, 100));
  await page.locator(".cart-btn").click();
  await expect(page).toHaveURL(/\/cart/);
  expect(errors).toEqual([]);
});

// Текущий раздел в меню: ровно один подсвеченный пункт во вкладках и не больше одного в меню сотрудника
async function checkMenus(page, sections, staffMenu) {
  for (const s of sections) {
    await page.goto(s.href);
    const tabs = page.getByRole("navigation", { name: "Разделы админки" });
    await expect(tabs.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(tabs.locator('[aria-current="page"]')).toHaveText(s.label);
    const menu = page.getByRole("navigation", { name: "Меню админки" });
    const lit = menu.locator('[aria-current="page"]');
    if (staffMenu.includes(s.label)) {
      await expect(lit).toHaveCount(1);
      await expect(lit).toContainText(s.label);
    } else {
      await expect(lit, `на «${s.label}» в меню сотрудника ничего чужого не подсвечено`).toHaveCount(0);
    }
  }
}

test("меню админки: подсвечен только текущий раздел — администратор и модератор", async ({ page, browser }) => {
  test.slow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, ["admin"]);
  await checkMenus(page, ADMIN_SECTIONS, ["Обзор", "Модерация", "Уведомления", "Статистика"]);
  // Карточка заказа — раздел «Заказы», не «Обзор»
  await page.goto("/admin/orders");
  const first = page.getByTestId("orders-table").locator("tbody tr td:first-child a").first();
  if (await first.count()) {
    await first.click();
    await expect(page).toHaveURL(/\/admin\/orders\/[^/?]+/);
    await expect(page.getByRole("navigation", { name: "Разделы админки" }).locator('[aria-current="page"]')).toHaveText("Заказы");
    await expect(page.getByRole("navigation", { name: "Меню админки" }).locator('[aria-current="page"]')).toHaveCount(0);
  }
  await deleteTestUser(admin, user);
  user = null;

  const ctx = await browser.newContext();
  const mod = await ctx.newPage();
  mod.on("pageerror", (e) => errors.push(e.message));
  await login(mod, ["moderator"]);
  await checkMenus(
    mod,
    ADMIN_SECTIONS.filter((s) => !s.admin),
    ["Обзор", "Модерация", "Уведомления"],
  );
  await ctx.close();
  expect(errors).toEqual([]);
});

test("лента статусов: пройденные — с галочкой, текущий — «сейчас» без галочки, будущие — бледные", async ({ page }) => {
  const password = process.env.SEED_PASSWORD_CLIENT;
  test.skip(!password, "нет пароля демо-клиента в окружении");
  const r = await page.request.post("/api/v1/auth/login", { data: { email: "client@example.com", password } });
  expect(r.status()).toBe(200);
  const list = await (await page.request.get("/api/v1/orders")).json();
  const ORDER = ["accepted", "moderation", "production", "shipped", "done"];
  // Заказ «в пути» (не завершён): лучше «Производство», как в находке
  const orders = (list.orders || list.items || []).filter((o) => ORDER.indexOf(o.status) >= 0 && o.status !== "done");
  const o = orders.find((x) => x.status === "production") || orders[0];
  test.skip(!o, "у демо-клиента нет незавершённого заказа");
  const idx = ORDER.indexOf(o.status);
  await page.goto(`/orders/${o.id}`);
  const steps = page.getByRole("list", { name: "Статус заказа" }).locator(":scope > li");
  await expect(steps).toHaveCount(5);
  for (let i = 0; i < 5; i++) {
    const li = steps.nth(i);
    if (i < idx) {
      await expect(li).toHaveAttribute("data-state", "done");
      await expect(li.locator(".dot svg")).toHaveCount(1);
    } else if (i === idx) {
      await expect(li).toHaveAttribute("data-state", "current");
      await expect(li).toHaveAttribute("aria-current", "step");
      await expect(li.locator(".dot svg"), "у текущего шага нет галочки").toHaveCount(0);
      await expect(li.locator(".timeline-now")).toHaveText("сейчас");
    } else {
      await expect(li).toHaveAttribute("data-state", "todo");
      await expect(li.locator(".dot svg")).toHaveCount(0);
      const color = await li.locator("b").evaluate((b) => getComputedStyle(b).color);
      const current = await steps.nth(idx).locator("b").evaluate((b) => getComputedStyle(b).color);
      expect(color, "будущий шаг бледнее текущего").not.toBe(current);
    }
  }
});
