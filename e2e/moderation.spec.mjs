// N4: модерация, которая реально работает. Настоящие модели на устройстве (без подмены __PICPAC_TEST__):
// • обычное фото — без флага и без процентов; фото с нацистской символикой — «Это фото проверит модератор»;
// • модели грузятся только с нашего сайта (ни одного запроса к сторонним хостам во время проверки);
// • сервер сам проверяет файл: даже с поддельными «чистыми» оценками фото попадает к модератору;
// • модератор видит вывод словами, фото размыто до «Показать», на компьютере — клавиши, затем история решений.
// Флаг со свастикой рисуется в тесте (SVG → JPEG), в репозитории такой картинки нет. Тестовые пользователи удаляются.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const DOG = readFileSync(new URL("../public/demo-gallery/dog.jpg", import.meta.url));
const RUN = `e2e-n4-${randomUUID().slice(0, 8)}`;
let admin;
const users = [];

async function flagJpeg(w = 900, h = 600) {
  const r = h * 0.3;
  const a = r * 0.62;
  const t = r * 0.2;
  const arm = `M ${-t / 2} ${-a} h ${t} v ${a - t / 2} h ${a - t / 2} v ${t} h ${-(a + t / 2)} Z M ${-t / 2} ${-a} h ${a} v ${t} h ${-a} Z`;
  const arms = [0, 90, 180, 270].map((d) => `<path d="${arm}" transform="rotate(${d})" fill="#000"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#d00"/><circle cx="${w / 2}" cy="${h / 2}" r="${r}" fill="#fff"/><g transform="translate(${w / 2} ${h / 2}) rotate(45)">${arms}</g></svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function login(page, user) {
  await page.goto("/login");
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test.beforeAll(() => {
  admin = supabaseAdmin();
});

test.afterAll(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  for (const u of users) await deleteTestUser(admin, u);
});

test("клиент: обычное фото — без флага и процентов, символика — «проверит модератор», модели только с нашего сайта", async ({ page, baseURL }) => {
  const user = await createTestUser(admin, ["client"], "n4c" + Date.now().toString(36).slice(-4));
  users.push(user);
  const errors = [];
  const foreign = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (/^https?:$/.test(u.protocol) && u.origin !== new URL(baseURL).origin && !u.hostname.endsWith(".supabase.co")) foreign.push(u.origin);
  });

  await login(page, user);
  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  const models = page.waitForResponse((r) => r.url().includes("/models/moderation/nsfw-384.onnx"), { timeout: 120_000 });
  await page.locator('input[type="file"][multiple]').setInputFiles([
    { name: "dog.jpg", mimeType: "image/jpeg", buffer: DOG },
    { name: "flag.jpg", mimeType: "image/jpeg", buffer: await flagJpeg() },
  ]);
  expect((await models).ok()).toBe(true);

  await expect(page.locator('.photo-cell[data-photo="dog.jpg"] [data-upload]')).toHaveText("Загружено", { timeout: 300_000 });
  await expect(page.locator('.photo-cell[data-photo="flag.jpg"] [data-upload]')).toHaveText("Загружено", { timeout: 300_000 });
  // Символика: флаг ставит сервер по оценкам с устройства (или своей проверке) — нейтральный значок и плашка
  await expect(page.locator('.photo-cell[data-photo="flag.jpg"] [data-badge="mod"]')).toBeVisible({ timeout: 180_000 });
  // Плашка — на шаге «Проверка»: нейтрально, без обвинений
  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
  await expect(page.getByTestId("moderation-notice")).toContainText("Это фото проверит модератор");
  await expect(page.locator('.photo-cell[data-photo="dog.jpg"] [data-badge="mod"]')).toHaveCount(0);
  // Нигде никаких процентов и сырых оценок: ни в плашке, ни на фото
  expect(await page.getByTestId("moderation-notice").innerText()).not.toMatch(/%|sexy|nsfw/i);
  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Фото" }).click();
  expect((await page.locator(".photo-cell").allInnerTexts()).join(" ")).not.toMatch(/%/);

  // Сервер проверил оба файла сам: собака — без находок, флаг — «нацистская символика»
  await expect
    .poll(
      async () => {
        const { data } = await admin.from("project_photos").select("moderation, moderation_flag").eq("user_id", user.id);
        return (data || []).map((r) => `${r.moderation_flag}:${(r.moderation?.findings || []).map((f) => f.id).join(",")}`).sort();
      },
      { timeout: 120_000 },
    )
    .toEqual(["false:", "true:nazi"]);
  expect(foreign, "запросы к сторонним хостам").toEqual([]);
  expect(errors).toEqual([]);
});

test("модератор: вывод словами, размытое фото до «Показать», клавиши и история решений", async ({ page }, info) => {
  const client = await createTestUser(admin, ["client"], "n4o" + Date.now().toString(36).slice(-4));
  const mod = await createTestUser(admin, ["moderator"], "n4m" + Date.now().toString(36).slice(-4));
  users.push(client, mod);
  // Заказ с флагом: клиент шлёт поддельные «чистые» оценки — сервер всё равно находит символику
  const fake = { v: 2, nsfw: 0.05, breast: 0, nude: 0, sex: 0, nazi: 0, weapon: 0, blood: 0, drugs: 0, art: 0 };
  const jpeg = await flagJpeg();
  const p = await client.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "N4", options: { size: "20x20", pages: 20 } } });
  const pid = p.json.project.id;
  const u = await client.client.req(`/api/v1/projects/${pid}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: jpeg.length } });
  expect((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: jpeg })).ok).toBe(true);
  const ph = await client.client.req(`/api/v1/projects/${pid}/photos`, { method: "POST", body: { path: u.json.upload.path, nsfw: fake } });
  expect(ph.json.photo.moderationFlag).toBe(false);
  await client.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: pid, quantity: 1 }] } });
  const o = await client.client.req("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": `${RUN}-${info.project.name.length}-${Date.now()}` },
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 7" } }, recipient: { name: "Тест Тестович", phone: "+375 29 765-43-21" } },
  });
  expect(o.status, o.text).toBe(201);
  expect((await client.client.req(`/api/v1/orders/${o.json.order.id}/pay-test`, { method: "POST", body: { method: "card_test" } })).status).toBe(200);
  // Как будто с оплаты прошло 10 минут: симулятор переводит заказ на «Модерацию» при чтении
  const past = new Date(Date.now() - 10 * 60_000).toISOString();
  await admin.from("orders").update({ status_changed_at: past, paid_at: past }).eq("id", o.json.order.id);
  expect((await client.client.req(`/api/v1/orders/${o.json.order.id}`)).json.order.status).toBe("moderation");
  const number = o.json.order.number;

  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, mod);
  await page.goto("/admin/moderation");
  const card = page.getByTestId("moderation-item").filter({ hasText: number });
  await expect(card).toBeVisible();
  await expect(card.getByTestId("moderation-findings")).toContainText("Найдено: нацистская символика (высокая уверенность)");
  expect(await card.innerText()).not.toMatch(/\d\s*%|sexy|nsfw/i);
  await expect(card.getByTestId("moderation-photo")).toHaveAttribute("data-blurred", "true");
  await expect(page.getByTestId("moderation-stats")).toContainText("В очереди");

  const desktop = (page.viewportSize()?.width || 0) >= 1024;
  if (desktop) {
    await expect(page.getByTestId("moderation-keys")).toContainText("A — одобрить");
    await card.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("s");
    await expect(card.getByTestId("moderation-photo")).toHaveAttribute("data-blurred", "false");
    await page.keyboard.press("a");
  } else {
    await expect(page.getByTestId("moderation-keys")).toHaveCount(0);
    await card.getByTestId("moderation-show").click();
    await expect(card.getByTestId("moderation-photo")).toHaveAttribute("data-blurred", "false");
    await card.getByRole("button", { name: "Одобрить" }).click();
  }
  await expect(page.getByRole("status").filter({ hasText: `Фото из заказа ${number} одобрено` })).toBeVisible();
  await page.getByRole("tab", { name: "История решений" }).click();
  const row = page.getByTestId("moderation-history").locator("tr", { hasText: number });
  await expect(row).toContainText("Одобрено");
  await expect(row).toContainText("Найдено: нацистская символика");
  expect(errors).toEqual([]);
});
