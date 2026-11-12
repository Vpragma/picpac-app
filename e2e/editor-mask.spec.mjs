// D1 / S03c: выделение касанием и ластик (вошедший клиент, телефон 390×844 и компьютер 1280×800).
// «Выделить касанием» → SlimSAM в воркере (модель из /models, wasm из /ort, строгая CSP) → касание собаки →
// «Размыть фон»: фон меняется, собака — нет → касание мяча → «Убрать» (MI-GAN): мяч исчез, остальное как было →
// «убери машину» без выделения → просьба коснуться → «Резкость для печати ×2» (если в браузере есть WebGL) →
// корзина → заказ → печатная версия в полном разрешении: фон размыт, мяча нет, середина собаки как в оригинале.
// Пользователь e2e-…@example.com создаётся и удаляется тестом. Консоль без ошибок.
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

let admin;
let user;

test.beforeEach(async ({}, info) => {
  admin = supabaseAdmin();
  user = await createTestUser(admin, ["client"], "e2emask" + info.parallelIndex + Date.now().toString(36).slice(-4));
});

test.afterEach(async () => {
  if (!user) return;
  await admin.from("orders").delete().eq("user_id", user.id);
  await deleteTestUser(admin, user);
  user = null;
});

// Пиксели canvas в долях (u, v): средний цвет квадрата 5×5
const px = (page, sel, u, v) =>
  page.evaluate(
    ([s, u, v]) => {
      const c = document.querySelector(s);
      const x = Math.round(u * c.width);
      const y = Math.round(v * c.height);
      const d = c.getContext("2d").getImageData(x - 2, y - 2, 5, 5).data;
      const out = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) out[k] += d[i + k] / 25;
      return out;
    },
    [sel, u, v],
  );

// «Резкость» участка: средняя разница соседних пикселей по горизонтали
const sharp = (page, sel, u0, v0, u1, v1) =>
  page.evaluate(
    ([s, u0, v0, u1, v1]) => {
      const c = document.querySelector(s);
      const x0 = Math.round(u0 * c.width);
      const y0 = Math.round(v0 * c.height);
      const w = Math.round((u1 - u0) * c.width);
      const h = Math.round((v1 - v0) * c.height);
      const d = c.getContext("2d").getImageData(x0, y0, w, h).data;
      let sum = 0;
      let n = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w - 1; x++) {
          const i = (y * w + x) * 4;
          sum += Math.abs(d[i + 1] - d[i + 5]);
          n++;
        }
      return sum / n;
    },
    [sel, u0, v0, u1, v1],
  );

const DOG = [0.55, 0.45]; // спина собаки на dog.jpg
const BALL = [0.22, 0.8]; // красный мяч
const BG = [0.08, 0.08, 0.3, 0.25]; // трава и тень в левом верхнем углу

async function tap(page, [u, v]) {
  const c = page.locator(".pe-after");
  const box = await c.boundingBox();
  await c.click({ position: { x: box.width * u, y: box.height * v } });
}

test("выделение касанием: размыть фон, убрать мяч, печатная версия в полном разрешении", async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/ServiceWorker|fetching the script/i.test(m.text()) && errors.push(m.text()));

  await page.goto("/login");
  await page.getByLabel("Почта").fill(user.email);
  await page.getByLabel("Пароль", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));

  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of ["dog", "nesvizh-small"]) await gallery.locator(`label:has(img[src="/demo-gallery/${f}.jpg"]) input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: "Добавить 2 фото" }).click();
  await expect(page.locator('.photo-cell[data-photo="dog.jpg"] [data-upload]')).toHaveText("Загружено", { timeout: 90_000 });

  await page.getByRole("button", { name: "Правки", exact: true }).click();
  await page.locator('[data-edit-photo="dog.jpg"]').click();
  await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);
  const bgBefore = await sharp(page, ".pe-after", ...BG);
  const dogBefore = await px(page, ".pe-after", ...DOG);
  const ballBefore = await px(page, ".pe-after", ...BALL);
  expect(ballBefore[0] - ballBefore[1]).toBeGreaterThan(60); // мяч красный

  await test.step("«Выделить касанием»: модель загружается и изучает фото (прогресс, без ошибок CSP)", async () => {
    await page.getByRole("button", { name: "Выделить касанием" }).click();
    await expect(page.locator(".pe-select progress")).toBeVisible();
    await expect(page.locator('.pe-select[data-ready="true"]')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Коснитесь предмета на фото.")).toBeVisible();
  });

  await test.step("касание собаки → выделено → «Размыть фон»: фон размыт, собака не тронута", async () => {
    await tap(page, DOG);
    await expect(page.getByText(/^Выделено\./)).toBeVisible({ timeout: 30_000 });
    await page.locator(".pe-select").getByRole("button", { name: "Размыть фон" }).click();
    await expect(page.locator(".pe-answer")).toHaveText(/Размыли фон/);
    await expect(page.locator(".pe-main .pe-name + .pe-badges .pe-badge")).toHaveText(["ИИ"]);
    await expect.poll(() => sharp(page, ".pe-after", ...BG)).toBeLessThan(bgBefore * 0.6);
    const dog = await px(page, ".pe-after", ...DOG);
    for (let k = 0; k < 3; k++) expect(Math.abs(dog[k] - dogBefore[k])).toBeLessThan(4);
  });

  await test.step("касание мяча (новое выделение) → «Убрать»: мяч исчез", async () => {
    await page.locator(".pe-select").getByRole("button", { name: "Сбросить" }).click();
    await tap(page, BALL);
    await expect(page.getByText(/^Выделено\./)).toBeVisible({ timeout: 30_000 });
    await page.locator(".pe-select").getByRole("button", { name: "Убрать", exact: true }).click();
    await expect(page.locator(".pe-busy")).toHaveCount(0, { timeout: 120_000 });
    await expect(page.locator(".pe-after[data-rendered]")).toHaveCount(1);
    await expect.poll(async () => {
      const b = await px(page, ".pe-after", ...BALL);
      return b[0] - b[1];
    }, { timeout: 30_000 }).toBeLessThan(30);
    // выделение после ластика сброшено — фото уже другое
    await expect(page.getByRole("button", { name: "Выделить касанием" })).toBeVisible();
  });

  await test.step("«убери машину» без выделения → просьба коснуться, ничего не меняем", async () => {
    await page.getByLabel("Что изменить?").fill("убери машину");
    await page.getByRole("button", { name: "Сделать" }).click();
    await expect(page.locator(".pe-answer")).toHaveText(/Коснитесь того, что убрать/);
    await expect(page.locator(".pe-select")).toContainText(/Загружаем|Изучаем|Коснитесь/);
    await page.locator(".pe-select").getByRole("button", { name: /^(Отмена|Готово)$/ }).click();
  });

  let upscaled = false;
  await test.step("«Резкость для печати ×2» для маленького фото (если есть WebGL)", async () => {
    await page.locator('[data-edit-photo="nesvizh-small.jpg"]').click();
    await page.getByRole("button", { name: "Резкость для печати ×2" }).click();
    const done = page.getByText("Резкость для печати ×2 включена");
    const noGl = page.getByText(/нет WebGL/);
    await expect(done.or(noGl)).toBeVisible({ timeout: 240_000 });
    upscaled = await done.isVisible();
    test.info().annotations.push({ type: "резкость", description: upscaled ? "WebGL есть — ×2 включена" : "в этом браузере нет WebGL — честный отказ" });
  });

  let order;
  await test.step("корзина → заказ: печатные версии собраны на устройстве", async () => {
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
    const { data } = await admin.from("orders").select("id, order_items(snapshot)").eq("user_id", user.id);
    order = data[0];
  });

  await test.step("печатная версия: полный размер, фон размыт, мяча нет, собака как в оригинале", async () => {
    const photos = order.order_items.flatMap((it) => it.snapshot?.photos || []);
    const dog = photos.find((p) => p.edits?.ops?.length);
    expect(dog?.edits?.print?.path).toBeTruthy();
    expect(dog.edits.ops.map((o) => o.act)).toEqual(["blurBg", "erase"]);
    expect([dog.edits.print.width, dog.edits.print.height]).toEqual([dog.width, dog.height]);
    const sign = async (path) => (await admin.storage.from("photos").createSignedUrl(path, 300)).data.signedUrl;
    const [printUrl, origUrl] = [await sign(dog.edits.print.path), await sign(dog.path || dog.storagePath)];
    const r = await page.evaluate(
      async ([a, b, DOG, BALL, BG]) => {
        const load = async (u) => {
          const bmp = await createImageBitmap(await (await fetch(u)).blob());
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d");
          ctx.drawImage(bmp, 0, 0);
          return { ctx, w: bmp.width, h: bmp.height };
        };
        const avg = (im, u, v) => {
          const d = im.ctx.getImageData(Math.round(u * im.w) - 4, Math.round(v * im.h) - 4, 9, 9).data;
          const o = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) o[k] += d[i + k] / 81;
          return o;
        };
        const grad = (im, [u0, v0, u1, v1]) => {
          const x0 = Math.round(u0 * im.w);
          const y0 = Math.round(v0 * im.h);
          const w = Math.round((u1 - u0) * im.w);
          const h = Math.round((v1 - v0) * im.h);
          const d = im.ctx.getImageData(x0, y0, w, h).data;
          let s = 0;
          for (let i = 0; i < d.length - 4; i += 4) s += Math.abs(d[i + 1] - d[i + 5]);
          return s / (d.length / 4);
        };
        const P = await load(a);
        const O = await load(b);
        return { size: [P.w, P.h, O.w, O.h], dogP: avg(P, ...DOG), dogO: avg(O, ...DOG), ballP: avg(P, ...BALL), ballO: avg(O, ...BALL), bgP: grad(P, BG), bgO: grad(O, BG) };
      },
      [printUrl, origUrl, DOG, BALL, BG],
    );
    expect(r.size.slice(0, 2)).toEqual(r.size.slice(2)); // полное разрешение, как оригинал
    expect(r.bgP).toBeLessThan(r.bgO * 0.6); // фон размыт
    expect(r.ballO[0] - r.ballO[1]).toBeGreaterThan(60);
    expect(r.ballP[0] - r.ballP[1]).toBeLessThan(30); // мяча нет
    for (let k = 0; k < 3; k++) expect(Math.abs(r.dogP[k] - r.dogO[k])).toBeLessThan(6); // собака не тронута (JPEG ±)
    if (upscaled) {
      const small = photos.find((p) => p.edits?.upscale === 2);
      expect([small.edits.print.width, small.edits.print.height]).toEqual([small.width * 2, small.height * 2]);
    }
  });

  expect(errors).toEqual([]);
});
