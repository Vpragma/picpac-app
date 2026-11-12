// N9: админка сильнее — журнал без шума (по умолчанию без автотестов, «×N» раскрывается, быстрые фильтры),
// заказы (фильтр «На модерации», поиск по номеру, CSV без персональных данных), роль модератора не видит разделы админа.
// Вход — свой тестовый админ night2-n9-…@example.com (создаётся и удаляется тестом; демо-аккаунты не трогаем).
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

let admin;
let user;

async function login(page, roles) {
  admin = supabaseAdmin();
  const email = `night2-n9-e2e-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Night2 E2E" } });
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

test("журнал: по умолчанию без автотестов, одинаковые подряд — «×3» с раскрытием, быстрые фильтры", async ({ page }) => {
  await login(page, ["admin"]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const marker = `night2-n9-e2e-${randomUUID().slice(0, 8)}`;
  for (let i = 0; i < 3; i++) {
    const { error } = await admin.from("audit_log").insert({ action: "access.denied", object_type: "route", object_id: marker, result: "denied", details: { test: "night2-n9-e2e" }, ip: "10.9.9.8" });
    expect(error).toBeNull();
  }

  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Журнал действий" })).toBeVisible();
  await expect(page.getByText(/Сейчас скрыто: системные события, ERP и симулятор, автотесты\./)).toBeVisible();
  await expect(page.getByTestId("audit-summary")).toBeVisible();
  // Вход самого теста (night2-…) — автотест: по умолчанию его не видно
  await expect(page.locator(".audit-row", { hasText: user.email })).toHaveCount(0);
  await expect(page.getByText(marker)).toHaveCount(0);

  // «Показать также: Автотесты» → видно; три одинаковые записи подряд — одна строка «×3»
  await page.getByTestId("audit-show-tests").click();
  await expect(page).toHaveURL(/tests=1/);
  await page.goto(`/admin/audit?tests=1&objectId=${marker}`);
  const group = page.getByTestId("audit-group");
  await expect(group).toHaveCount(1);
  await expect(group.getByTestId("audit-count")).toHaveText("×3");
  await group.getByText("Показать все 3").click();
  await expect(group.locator(".audit-mini li")).toHaveCount(3);
  await expect(group.locator(".audit-mini li").first()).toContainText(marker);

  // Быстрый фильтр «Входы»: только вход, выход, регистрация, выбор роли, 2FA
  await page.goto("/admin/audit?tests=1");
  await page.getByTestId("audit-quick-logins").click();
  await expect(page).toHaveURL(/quick=logins/);
  const titles = await page.locator(".audit-row > .row b").allInnerTexts();
  expect(titles.length).toBeGreaterThan(0);
  for (const t of titles) expect(t.replace(/×\d+/, "").trim()).toMatch(/^(Вход|Выход|Регистрация|Выбор роли|Подключение кода 2FA|Проверка кода 2FA)$/);
  expect(errors).toEqual([]);
});

test("заказы: «На модерации», поиск по номеру, страницы и CSV без персональных данных", async ({ page }) => {
  await login(page, ["admin"]);
  await page.goto("/admin/orders");
  await expect(page.getByRole("heading", { name: "Заказы", exact: true })).toBeVisible();
  const table = page.getByTestId("orders-table");
  await expect(table).toBeVisible();

  await page.getByRole("link", { name: "На модерации", exact: true }).click();
  await expect(page).toHaveURL(/moderation=1/);
  const chips = await table.locator("tbody .status-chip").allInnerTexts();
  expect(chips.length).toBeGreaterThan(0);
  expect(new Set(chips)).toEqual(new Set(["Модерация"]));

  // Поиск по номеру — через форму
  const number = (await table.locator("tbody tr td:first-child a").first().innerText()).trim();
  await page.goto("/admin/orders");
  await page.getByText("Поиск и фильтры").click();
  await page.getByLabel("Номер заказа").fill(number.slice(-5));
  await page.getByRole("button", { name: "Найти" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${number.slice(-5)}`));
  await expect(page.getByTestId("orders-table").getByRole("link", { name: number })).toBeVisible();

  // Карточка заказа — всё в одном месте
  await page.getByTestId("orders-table").getByRole("link", { name: number }).click();
  await expect(page.getByRole("heading", { name: `№ ${number}` })).toBeVisible();
  for (const h of ["Заказ и оплата", "Состав", "Лента статусов", "Модерация", "Переписка с клиентом", "Действия по заказу"]) await expect(page.getByRole("heading", { name: h, exact: true })).toBeVisible();

  // CSV: ровно 6 столбцов, без почты и телефонов
  await page.goto("/admin/orders?moderation=1");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("orders-csv").click()]);
  expect(download.suggestedFilename()).toMatch(/^picpac-orders-.*\.csv$/);
  const text = (await readFile(await download.path(), "utf8")).replace(/^﻿/, "");
  const lines = text.trim().split("\r\n");
  expect(lines[0]).toBe("Номер;Дата (Минск);Продукт;Сумма, BYN;Статус;Город");
  expect(lines.length).toBeGreaterThan(1);
  expect(text).not.toMatch(/@|\+375/);
});

test("модератор не видит заказы, пользователей и каталог — 403", async ({ page }) => {
  await login(page, ["moderator"]);
  for (const path of ["/admin/orders", "/admin/users", "/admin/catalog", "/admin/audit"]) {
    const r = await page.goto(path);
    expect(r.status(), path).toBe(403);
  }
  await page.goto("/admin/moderation");
  await expect(page.getByRole("navigation", { name: "Разделы админки" }).getByRole("link", { name: "Пользователи" })).toHaveCount(0);
});

test("пользователи: выдать и снять роль модератора кнопкой; каталог: старая цена не больше текущей — понятная ошибка", async ({ page }) => {
  await login(page, ["admin"]);
  // Цель — свой тестовый клиент night2-n9-…
  const email = `night2-n9-e2e-target-${randomUUID().slice(0, 8)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: randomBytes(18).toString("base64url"), email_confirm: true, user_metadata: { full_name: "Night2 Цель" } });
  expect(error).toBeNull();
  const target = { id: data.user.id, email };
  try {
    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/users?q=${encodeURIComponent(email)}&tests=1`);
    const row = page.locator(`tr[data-user="${target.id}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("n•••@example.com");
    await row.getByTestId("role-grant-moderator").click();
    await expect(row.getByRole("status")).toHaveText("Роль «модератор» выдана.");
    await expect(row.locator(".status-chip", { hasText: "Модератор" })).toBeVisible();
    await row.getByTestId("role-revoke-moderator").click();
    await expect(row.getByRole("status")).toHaveText("Роль «модератор» снята.");
    await expect(row.locator(".status-chip", { hasText: "Модератор" })).toHaveCount(0);
    // Свою строку менять нельзя
    await page.goto(`/admin/users?q=${encodeURIComponent(user.email)}&tests=1`);
    await expect(page.locator(`tr[data-user="${user.id}"]`)).toContainText("Свои роли менять нельзя");
  } finally {
    await deleteTestUser(admin, target);
  }

  // Каталог: старая цена равна текущей — сервер отказывает, цена не меняется
  await page.goto("/admin/catalog");
  const form = page.getByTestId("catalog-form-digital");
  const before = await form.getByLabel("Старая цена «от», BYN").inputValue();
  const { data: sizes } = await admin.from("product_sizes").select("unit_price_kop").eq("product_slug", "digital").eq("active", true);
  const from = Math.min(...sizes.map((x) => x.unit_price_kop));
  await form.getByLabel("Старая цена «от», BYN").fill((from / 100).toFixed(2).replace(".", ","));
  await form.getByRole("button", { name: "Сохранить" }).click();
  await expect(form.getByRole("status")).toContainText("Старая цена должна быть больше текущей");
  const { data: p } = await admin.from("products").select("old_price_kop").eq("slug", "digital").single();
  expect(p.old_price_kop == null ? "" : (p.old_price_kop / 100).toFixed(2).replace(".", ",")).toBe(before);
});
