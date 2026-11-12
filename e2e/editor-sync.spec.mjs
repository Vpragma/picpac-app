// Правки ИИ-редактора переживают синхронизацию (МП-03): вошедший клиент улучшает фото и говорит «сделай ярче» →
// правки уходят в аккаунт (options.settings.edits по id фото на сервере) → выход стирает устройство →
// после входа проект загружается из аккаунта вместе с правками. Пользователь e2e-…@example.com удаляется после теста.
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

let admin;
let user;

// W-15: подмена результата классификатора nsfwjs — «чистое» фото (настоящая модель на CPU в headless ≈ 3 с на фото)
test.beforeEach(async ({ page }) => page.addInitScript(() => (window.__PICPAC_TEST__ = { ...(window.__PICPAC_TEST__ || {}), nsfw: "clean" })));
test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  user = await createTestUser(admin, ["client"], "e2eai" + info.parallelIndex + Date.now().toString(36).slice(-4));
});

test.afterEach(async () => {
  if (!user) return;
  await deleteTestUser(admin, user);
  user = null;
});

async function login(page) {
  await page.goto("/login");
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// Правки фото проектов на устройстве (IndexedDB «picpac»)
const localEdits = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("picpac");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) return resolve([]);
          const r = db.transaction("kv").objectStore("kv").getAll(IDBKeyRange.bound("project:", "project:￿"));
          r.onsuccess = () => {
            db.close();
            resolve(r.result.flatMap((p) => (p.photos || []).map((ph) => ({ serverId: ph.serverId || null, edits: ph.edits || null }))));
          };
        };
      }),
  );

// Правки в аккаунте: options.settings.edits всех проектов пользователя
async function serverEdits() {
  const list = await user.client.req("/api/v1/projects");
  const out = [];
  for (const p of list.json?.items || []) {
    const g = await user.client.req(`/api/v1/projects/${p.id}`);
    for (const [photoId, e] of Object.entries(g.json?.project?.options?.settings?.edits || {})) out.push({ photoId, ...e });
  }
  return out;
}

test("правки фото уходят в аккаунт и возвращаются после выхода и входа", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await login(page);
  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["cat-dark", "mir-castle"]) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 2 фото" }).click();
  await expect.poll(() => page.locator('.photo-cell[data-photo="cat-dark.jpg"] .pe-badge').allTextContents(), { timeout: 60_000 }).toEqual(["Темно", "Улучшено"]);
  // X-5 (S07): у вошедшего клиента на фото видно, что они загружены в аккаунт
  await expect(page.locator('.photo-cell[data-photo="mir-castle.jpg"] [data-upload]')).toHaveText("Загружено", { timeout: 300_000 });

  await page.getByRole("button", { name: "Правки", exact: true }).click();
  await page.locator('[data-edit-photo="cat-dark.jpg"]').click();
  await page.getByLabel("Что изменить?").fill("сделай ярче");
  await page.getByRole("button", { name: "Сделать" }).click();
  await expect(page.locator(".pe-answer")).toHaveText(/Сделали ярче/);

  // В аккаунте: у одного фото — автоулучшение и «Яркость +20»; у хорошего фото правок нет
  await expect
    .poll(async () => (await serverEdits()).map((e) => `${!!e.auto}:${e.manual?.exposure || 0}`), { timeout: 90_000 })
    .toEqual(["true:20"]);

  await page.goto("/profile");
  await page.getByRole("button", { name: "Выйти" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/profile"), { timeout: 60_000 });
  expect(await localEdits(page)).toEqual([]);

  await login(page);
  await page.goto("/books");
  await expect
    .poll(async () => (await localEdits(page)).filter((x) => x.edits).map((x) => `${!!x.edits.auto}:${x.edits.manual?.exposure || 0}`), { timeout: 120_000 })
    .toEqual(["true:20"]);
  expect(errors).toEqual([]);
});

// N7 (требование жюри N3): у вошедшего клиента местные правки — маска «размой собаку» (силуэт, rle) и «убери солнце»
// (координаты круга) — не уходят на сервер ни при автосохранении проекта, ни с печатной версией. В аккаунте — только
// общие параметры и число местных правок; печатная версия, собранная на устройстве, их учитывает (собака размыта).
const FORBIDDEN = new Set(["rle", "masks", "mask", "ops", "cx", "cy", "points", "box"]);
function forbiddenKeys(value, path = "", out = []) {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k)) out.push(path + k);
      forbiddenKeys(v, path + k + ".", out);
    }
  }
  return out;
}

test("местные правки остаются на устройстве: «размой собаку» и «убери солнце» — ни масок, ни координат в запросах", async ({ page, context }, info) => {
  test.skip(info.project.name.startsWith("телефон"), "проверка запросов: одного устройства достаточно");
  test.setTimeout(14 * 60_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const sent = new Map();
  const add = (r) => {
    if (r.method() === "GET" || r.method() === "HEAD") return;
    sent.set(r.method() + " " + r.url() + " " + (r.postDataBuffer()?.length || 0) + " " + sent.size, r);
  };
  context.on("request", add);

  await login(page);
  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["dog", "sunset-sun"]) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 2 фото" }).click();
  for (const f of ["dog.jpg", "sunset-sun.jpg"]) await expect(page.locator(`.photo-cell[data-photo="${f}"] [data-upload]`)).toHaveText("Загружено", { timeout: 300_000 });

  await page.getByRole("button", { name: "Правки", exact: true }).click();
  await page.locator('[data-edit-photo="dog.jpg"]').click();
  await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);
  // Плашка честно говорит, где фото: у вошедшего — в аккаунте; правки по выделению — на этом телефоне
  const note = page.locator("[data-local-ai]");
  await expect(note).toHaveAttribute("data-storage", "account");
  await expect(note).toContainText("фото и команды для правок никуда не отправляются");
  await expect(note).toContainText("хранятся в вашем аккаунте PicPac");

  await page.getByLabel("Что изменить?").fill("размой собаку");
  await page.getByRole("button", { name: "Сделать" }).click();
  await expect(page.locator(".pe-answer")).toHaveText(/Нашёл собаку и размыл/, { timeout: 240_000 });
  await page.locator('[data-edit-photo="sunset-sun.jpg"]').click();
  await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);
  await page.getByLabel("Что изменить?").fill("убери солнце");
  await page.getByRole("button", { name: "Сделать" }).click();
  await expect(page.locator(".pe-answer")).toHaveText(/Убрали солнце/, { timeout: 60_000 });

  // Автосохранение дошло до аккаунта: у обоих фото — по одной местной правке, но только числом
  await expect.poll(async () => (await serverEdits()).map((e) => e.local).sort(), { timeout: 90_000 }).toEqual([1, 1]);
  for (const e of await serverEdits()) expect(forbiddenKeys(e), JSON.stringify(e)).toEqual([]);

  // Заказ: печатная версия собирается на устройстве со всеми правками
  await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
  const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
  await expect(toCart).toBeVisible();
  for (let i = 0; i < 6 && (await toCart.isDisabled()); i++) {
    const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
    if (await go.isVisible().catch(() => false)) await go.click();
  }
  await toCart.click();
  await expect(page).toHaveURL(/\/cart/);
  await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
  await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
  await page.locator('input[name="delivery"]').first().check();
  await page.locator("#f-pickup_point").selectOption({ index: 1 });
  await page.locator('input[name="payment"]').nth(1).check();
  await page.getByRole("button", { name: "Подтвердить заказ" }).click();
  await expect(page.getByRole("heading", { name: "Заказ оформлен" })).toBeVisible({ timeout: 300_000 });

  // Ни один пишущий запрос (автосохранение, печатная версия, заказ, аналитика) не нёс масок и координат
  const writes = [...sent.values()];
  const bad = [];
  for (const r of writes) {
    const buf = r.postDataBuffer();
    if (!buf?.length || /^image\//.test(r.headers()["content-type"] || "")) continue;
    const text = buf.toString("utf8");
    if (/"rle"|"masks"|"cx"|"cy"/.test(text)) bad.push(`${r.method()} ${new URL(r.url()).pathname}`);
    try {
      const keys = forbiddenKeys(JSON.parse(text));
      if (keys.length) bad.push(`${r.method()} ${new URL(r.url()).pathname}: ${keys.join(", ")}`);
    } catch {
      // не JSON (файл фото в хранилище) — проверен выше по тексту
    }
  }
  expect(bad).toEqual([]);
  expect(writes.filter((r) => r.method() === "PATCH" && /\/api\/v1\/projects\/[0-9a-f-]+$/.test(new URL(r.url()).pathname)).length).toBeGreaterThan(0);
  expect(writes.filter((r) => r.method() === "PUT" && /\/print$/.test(new URL(r.url()).pathname)).length).toBeGreaterThan(0);

  // В базе: правки фото без масок и координат, печатная версия есть; собака на ней размыта, остальное как было
  const { data: rows } = await admin.from("project_photos").select("storage_path, print_path, edits, quality").eq("user_id", user.id);
  expect(rows).toHaveLength(2);
  for (const r of rows) {
    expect(forbiddenKeys(r.edits), JSON.stringify(r.edits)).toEqual([]);
    expect(r.edits.local).toBe(1);
    expect(r.print_path).toBeTruthy();
  }
  const dog = rows.find((r) => r.quality?.name === "dog.jpg");
  const b64 = async (path) => Buffer.from(await (await admin.storage.from("photos").download(path)).data.arrayBuffer()).toString("base64");
  const diff = await page.evaluate(
    async ([a, b]) => {
      const load = (s) => createImageBitmap(new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))], { type: "image/jpeg" }));
      const [orig, print] = await Promise.all([load(a), load(b)]);
      const W = 300;
      const H = Math.round((W * orig.height) / orig.width);
      const px = (bmp) => {
        const c = new OffscreenCanvas(W, H);
        const x = c.getContext("2d");
        x.drawImage(bmp, 0, 0, W, H);
        return x.getImageData(0, 0, W, H).data;
      };
      const A = px(orig);
      const B = px(print);
      const box = (u0, u1, v0, v1) => {
        let s = 0;
        let n = 0;
        for (let y = Math.round(v0 * H); y < Math.round(v1 * H); y++)
          for (let x = Math.round(u0 * W); x < Math.round(u1 * W); x++) {
            const i = (y * W + x) * 4;
            s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
            n += 3;
          }
        return s / n;
      };
      return { dog: box(0.4, 0.75, 0.3, 0.65), corner: box(0.02, 0.14, 0.05, 0.2) };
    },
    [await b64(dog.storage_path), await b64(dog.print_path)],
  );
  test.info().annotations.push({ type: "печатная версия", description: `разница с оригиналом: собака ${diff.dog.toFixed(1)}, угол ${diff.corner.toFixed(1)}` });
  expect(diff.dog).toBeGreaterThan(3);
  expect(diff.dog).toBeGreaterThan(diff.corner * 2);
  expect(errors).toEqual([]);
});
