// Обязательный путь ТЗ и критерии приёмки 6.4 — одним сценарием на телефоне (390×844) и компьютере (1280×800):
// AC-1 гость: каталог → продукт → «Тестовая галерея» (12 фото) → автомакет → проверка → корзина → вход → TEST10 →
//      доставка → тестовая оплата → номер заказа;
// AC-2 порядок фото после перезагрузки, после выхода и входа — проект и порядок из аккаунта;
// AC-3 маленькое фото → предупреждение с объяснением: «Заменить фото» и «Продолжить всё равно»;
// AC-4 обрыв сети на «Подтвердить»: форма цела, ошибка понятна; повтор (двойным кликом) → ровно один заказ (по API);
// AC-5 история → заказ: состав, сумма, статус, обращение в поддержку с ответом бота;
// выход стирает данные устройства; гостевая корзина переносится в аккаунт.
// Пользователь e2e-…@example.com создаётся перед тестом и удаляется после (вместе с заказами и файлами).
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const GOOD = ["mir-castle", "nesvizh", "braslav-lake", "bison", "dog", "cat", "autumn-forest", "flowers", "beach", "sunset-sun", "winter-field", "cake"];
const SMALL = "nesvizh-small";
const GALLERY_DIR = path.resolve("public/demo-gallery");

let admin;
let user;

// W-15: подмена результата классификатора nsfwjs — «чистое» фото (настоящая модель на CPU в headless ≈ 3 с на фото)
test.beforeEach(async ({ page }) => page.addInitScript(() => (window.__PICPAC_TEST__ = { ...(window.__PICPAC_TEST__ || {}), nsfw: "clean" })));
test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  user = await createTestUser(admin, ["client"], "e2e" + info.parallelIndex + Date.now().toString(36).slice(-4));
});

test.afterEach(async () => {
  if (!user) return;
  await admin.from("orders").delete().eq("user_id", user.id);
  await deleteTestUser(admin, user);
  user = null;
});

// Проекты на устройстве (IndexedDB «picpac», хранилище kv, ключи project:*)
async function localProjects(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("picpac");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) return resolve({ projects: [], keys: [], photos: 0 });
          const tx = db.transaction(["kv", "photos"], "readonly");
          const kv = tx.objectStore("kv");
          const out = { projects: [], keys: [], photos: 0 };
          kv.getAllKeys().onsuccess = (e) => (out.keys = e.target.result.map(String));
          kv.getAll(IDBKeyRange.bound("project:", "project:￿")).onsuccess = (e) =>
            (out.projects = e.target.result.map((p) => ({ id: p.id, serverId: p.serverId, status: p.status, photos: (p.photos || []).map((x) => x.serverId || null) })));
          tx.objectStore("photos").count().onsuccess = (e) => (out.photos = e.target.result);
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
      }),
  );
}

const photoNames = (page) => page.locator(".photo-cell[data-photo]").evaluateAll((els) => els.map((e) => e.getAttribute("data-photo")));

async function pickFromGallery(page, files) {
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of files) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: `Добавить ${files.length} фото` }).click();
}

// Обязательные поля оформления: гость заполняет их до входа (форма сохраняется на устройстве)
async function fillCheckout(page) {
  await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
  await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
  await page.locator('input[name="delivery"]').first().check();
  await page.locator("#f-pickup_point").selectOption({ index: 1 });
  await page.locator('input[name="payment"]').nth(1).check();
}

async function login(page) {
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
}

test("обязательный путь: каталог → проект → 12 фото → корзина → номер заказа, AC-1…AC-5", async ({ page }) => {
  test.slow(); // сеть площадки ~1,4 Мбит/с: 14 фото по 3000 точек скачиваются и уходят в аккаунт минутами — общий лимит ×3
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await test.step("AC-1 гость: каталог → продукт → проект", async () => {
    await page.goto("/");
    await page.locator('a[href="/product/photopaper-book"]').first().click();
    await expect(page).toHaveURL(/\/product\/photopaper-book/);
    await page.getByRole("button", { name: "Создать фотокнигу" }).click();
    await expect(page).toHaveURL(/\/editor/);
  });

  await test.step("AC-1 «Тестовая галерея»: 12 фото", async () => {
    await pickFromGallery(page, GOOD);
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(12, { timeout: 120_000 });
    await expect(page.locator(".photo-cell img")).toHaveCount(12, { timeout: 120_000 });
  });

  let order12;
  await test.step("AC-2 перезагрузка: порядок тот же", async () => {
    order12 = await photoNames(page);
    await page.waitForTimeout(400); // черновик пишется в IndexedDB не позже 0,15 с после изменения
    await page.reload();
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(12);
    expect(await photoNames(page)).toEqual(order12);
  });

  await test.step("AC-1 автомакет", async () => {
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Автомакет" }).click();
    await expect(page.getByText(/Автомакет разложил фото по страницам/)).toBeVisible();
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Фото" }).click();
  });

  await test.step("AC-3 маленькое фото: предупреждение, «Заменить фото»", async () => {
    await pickFromGallery(page, [SMALL]);
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(13, { timeout: 60_000 });
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
    const issue = page.locator(".card.issue").filter({ hasText: /нечётко|размыто/ });
    await expect(issue).toHaveCount(1);
    await expect(issue).toContainText(/точек на дюйм|разрешени|Замените|крупнее/i);
    const chooser = page.waitForEvent("filechooser");
    await issue.getByRole("button", { name: "Заменить фото" }).click();
    await (await chooser).setFiles(path.join(GALLERY_DIR, "mir-castle.jpg"));
    await expect(page.locator(".card.issue").filter({ hasText: /нечётко|размыто/ })).toHaveCount(0, { timeout: 60_000 });
  });

  await test.step("AC-3 маленькое фото: «Продолжить всё равно»", async () => {
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Фото" }).click();
    await pickFromGallery(page, [SMALL]);
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(14, { timeout: 60_000 });
    await page.getByRole("navigation", { name: "Шаги редактора" }).getByRole("button", { name: "Проверка" }).click();
    const issue = page.locator(".card.issue").filter({ hasText: /нечётко|размыто/ });
    await expect(issue).toHaveCount(1);
    await issue.getByRole("button", { name: "Продолжить всё равно" }).click();
    await expect(page.getByText("— оставили как есть")).toBeVisible();
  });

  await test.step("AC-1 проверка → корзина (счётчик в шапке)", async () => {
    // Остальные замечания (если есть): пустые страницы — подогнать, прочее — продолжить
    const toCart = page.getByRole("button", { name: /^(В корзину|Обновить в корзине)$/ });
    for (let i = 0; i < 6 && (await toCart.isDisabled()); i++) {
      const fit = page.getByRole("button", { name: /^Сделать \d+ стр\.$/ }).first();
      const go = page.getByRole("button", { name: "Продолжить всё равно" }).first();
      if (await fit.isVisible().catch(() => false)) await fit.click();
      else if (await go.isVisible().catch(() => false)) await go.click();
    }
    // N7: двойное нажатие — одна позиция и одно уведомление
    await toCart.dblclick();
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.locator(".cart-btn .badge")).toHaveText("1");
    await expect(page.getByText("Добавлено в корзину")).toHaveCount(1);
  });

  await test.step("AC-1 «Подтвердить заказ» гостем → вход → гостевая корзина в аккаунте", async () => {
    await expect(page.getByText(/Чтобы подтвердить заказ, войдите или зарегистрируйтесь/)).toBeVisible();
    // Пустая форма: гость остаётся в корзине, фокус на первом незаполненном поле (баг 6)
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByLabel("Имя и фамилия")).toBeFocused();
    await fillCheckout(page);
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page).toHaveURL(/\/login\?reason=checkout/);
    await expect(page.getByRole("link", { name: "Вернуться в корзину" })).toBeVisible(); // баг 7: не тупик «Продолжить как гость»
    await expect(page.getByText(/парол[ья]\s*[:—-]/i)).toHaveCount(0); // никаких демо-паролей на экране входа
    await login(page);
    await expect(page).toHaveURL(/\/cart/);
    await expect(page.getByLabel("Имя и фамилия")).toBeVisible();
    // фото галереи теперь 3000 точек (~750 КБ): на сети площадки (~1,4 Мбит/с) перенос 14 фото — минуты
    await expect.poll(async () => (await user.client.req("/api/v1/cart")).json?.cart?.items?.length, { timeout: 300_000 }).toBe(1);
  });

  await test.step("AC-1 получатель, TEST10, доставка, тестовая оплата", async () => {
    await page.getByLabel("Имя и фамилия").fill("Тест Тестович");
    await page.getByLabel("Телефон").fill("+375 (29) 123-45-67");
    await page.getByRole("textbox", { name: "Промокод" }).fill("TEST10");
    await page.getByRole("button", { name: "Применить" }).click();
    await expect(page.getByText(/применён/i).first()).toBeVisible();
    await page.locator('input[name="delivery"]').first().check();
    await page.locator("#f-pickup_point").selectOption({ index: 1 });
    await page.locator('input[name="payment"]').nth(1).check();
    await expect(page.getByText("Деньги не списываются").first()).toBeVisible();
  });

  let number;
  await test.step("AC-4 обрыв сети на «Подтвердить»: понятная ошибка, форма цела", async () => {
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Подтвердить заказ" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /связ|интернет|сет/i }).first()).toBeVisible();
    await expect(page.getByLabel("Имя и фамилия")).toHaveValue("Тест Тестович");
    await page.context().setOffline(false);
  });

  await test.step("AC-4 + двойной клик: повтор даёт ровно один заказ (проверка по API)", async () => {
    await page.getByRole("button", { name: /^(Повторить|Подтвердить заказ)$/ }).dblclick();
    await expect(page.getByRole("heading", { name: "Заказ оформлен" })).toBeVisible({ timeout: 120_000 });
    number = (await page.getByText(/^№ PP-\d{6}-\d+$/).textContent()).replace("№ ", "").trim();
    expect(number).toMatch(/^PP-\d{6}-\d+$/);
    const list = (await user.client.req("/api/v1/orders")).json;
    expect(list.items.map((o) => o.number)).toEqual([number]);
  });

  await test.step("AC-5 заказ: состав, сумма, статус, обращение в поддержку", async () => {
    await page.getByRole("link", { name: "Открыть заказ" }).click();
    await expect(page.getByTestId("order-number")).toHaveText(`№ ${number}`);
    await expect(page.getByRole("heading", { name: "Состав" })).toBeVisible();
    await expect(page.getByText(/14 фото/)).toBeVisible();
    await expect(page.locator(".sum-total")).toContainText("BYN");
    await expect(page.getByText(/Скидка TEST10/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Статус заказа" }).locator("li")).toHaveCount(5);
    await page.getByRole("button", { name: "Написать в поддержку" }).click();
    await page.getByLabel("Сообщение").fill("Когда привезут? Тест e2e.");
    await page.getByRole("button", { name: "Отправить" }).click();
    await expect(page.getByTestId("interaction")).toHaveCount(1);
  });

  await test.step("AC-5 история → заказ", async () => {
    await page.goto("/orders");
    await page.locator(`a[data-number="${number}"]`).click();
    await expect(page.getByTestId("order-number")).toHaveText(`№ ${number}`);
    await expect(page.getByText(/Итого/).first()).toBeVisible();
    await expect(page.locator(".chip[data-status]").first()).toBeVisible();
    const it = page.getByTestId("interaction");
    await expect(it).toContainText("Где мой заказ?");
    await it.getByRole("button", { name: "Показать переписку" }).click();
    await expect(it).toContainText(/Обращение по заказу .* получено/);
  });

  let before;
  await test.step("выход: синхронизация, затем устройство стёрто", async () => {
    before = await localProjects(page);
    const mine = before.projects.find((p) => p.status === "ordered");
    expect(mine?.serverId).toBeTruthy();
    expect(mine.photos.every(Boolean)).toBe(true); // все фото уже в аккаунте
    await page.goto("/profile");
    await page.getByRole("button", { name: "Выйти" }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/profile"), { timeout: 60_000 });
    const after = await localProjects(page);
    expect(after.projects).toEqual([]);
    expect(after.photos).toBe(0);
    expect(after.keys.filter((k) => /^(project:|currentId$|x:checkoutKey$|x:serverDeletes$)/.test(k))).toEqual([]);
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("picpac:") && k !== "picpac:notifications"));
    expect(keys).toEqual([]);
  });

  await test.step("AC-2 вход: проект, порядок фото и заказ из аккаунта", async () => {
    await page.goto("/login");
    await login(page);
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await page.goto("/books");
    const mineBefore = before.projects.find((p) => p.status === "ordered");
    // Карточка проекта из аккаунта видна сразу (по метаданным), фото докачиваются в фоне
    const t0 = Date.now();
    await expect(page.getByRole("heading", { name: "Заказанные" })).toBeVisible({ timeout: 10_000 });
    expect(Date.now() - t0).toBeLessThan(10_000);
    await expect(page.getByTestId("account-loading")).toHaveCount(0);
    await expect
      .poll(async () => (await localProjects(page)).projects.find((p) => p.serverId === mineBefore.serverId)?.photos.join(","), { timeout: 15_000 })
      .toBe(mineBefore.photos.join(","));
    await page.goto("/orders");
    await expect(page.locator(`a[data-number="${number}"]`)).toBeVisible();
  });

  expect(errors).toEqual([]);
});
