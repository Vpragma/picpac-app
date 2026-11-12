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
