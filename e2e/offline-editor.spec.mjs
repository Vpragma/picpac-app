// N7 (критик C, круг 2): редактор без сети. Куски, которые редактор грузит по требованию (перетаскивание фото,
// «Правки», превью книги, анализ фото), заранее попадают в кэш сервис-воркера, пока сеть есть (lib/editorWarm.js,
// public/sw.js). Кусок всё-таки не скачан — понятный текст, а не «Что-то пошло не так». Только гость: аккаунты не создаются.
import { expect, test } from "@playwright/test";
import path from "node:path";

const GALLERY = path.resolve("public/demo-gallery");
const FILES = ["bison.jpg", "beach.jpg"].map((f) => path.join(GALLERY, f));

// Без сети: setOffline — для страницы, маршрут обрывает и запросы самого сервис-воркера (как e2e/pwa.spec.mjs)
async function setOfflineAll(context, offline) {
  await context.setOffline(offline);
  if (offline) await context.route("**/*", (route) => route.abort("internetdisconnected"));
  else await context.unrouteAll({ behavior: "ignoreErrors" });
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    // «Failed to load resource: net::ERR_INTERNET_DISCONNECTED» у запросов API без сети — норма; ошибки кусков кода — нет
    if (m.type() === "error" && /ChunkLoadError|Failed to load chunk|Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => localStorage.setItem("pp:onboarding", "done"));
});

test.describe("с сервис-воркером", () => {
  test("пустой черновик открыт с сетью → без сети 2 фото с устройства → «Правки» работают", async ({ page, context }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);

    await test.step("первый визит: воркер ставится, страница под его управлением", async () => {
      await page.goto("/");
      await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 90_000 }).toBe(true);
      await page.reload();
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    });

    await test.step("пустой черновик «Печати фото»; куски редактора — на устройстве", async () => {
      await page.goto("/product/photo");
      await page.getByRole("button", { name: "Выбрать фото" }).click();
      await expect(page).toHaveURL(/\/editor/);
      await expect(page.locator("html")).toHaveAttribute("data-editor-warm", "done", { timeout: 60_000 });
      await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(0);
    });

    await test.step("сеть отрезана → 2 фото с устройства → в черновике, редактор не упал", async () => {
      await setOfflineAll(context, true);
      await page.locator('input[type="file"][multiple]').setInputFiles(FILES);
      await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 30_000 });
      await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    });

    await test.step("«Правки» без сети открываются (кусок прогрет), «Автомакет» тоже", async () => {
      await page.getByRole("button", { name: "Правки", exact: true }).click();
      await expect(page.getByRole("list", { name: "Фото проекта" })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("[data-offline-step]")).toHaveCount(0);
      await page.getByRole("button", { name: "Автомакет", exact: true }).click();
      await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
      await page.getByRole("button", { name: "Фото", exact: true }).click();
      await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2);
    });

    await test.step("перезагрузка без сети: редактор из кэша, перетаскивание и «Правки» работают", async () => {
      await page.reload();
      await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 30_000 });
      await page.getByRole("button", { name: "Правки", exact: true }).click();
      await expect(page.getByRole("list", { name: "Фото проекта" })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    });

    await setOfflineAll(context, false);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  // Воркер новой версии ставится, пока сеть есть, и сразу кладёт в свой кэш куски редактора (public/sw.js,
  // cacheLazyChunks). Сеть пропала → «Обновить» → старые кэши удалены, страница из кэша новой версии — фото на месте,
  // перетаскивание и «Правки» работают (прогрев в странице без сети не запускается — только кэш установки).
  test("новая версия поставлена с сетью → сеть пропала → «Обновить» → черновик с фото и «Правки» работают", async ({ page, context }) => {
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    const NEXT = "e2e-offline-next";

    await page.goto("/");
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active), { timeout: 90_000 }).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);

    await page.goto("/product/photo");
    await page.getByRole("button", { name: "Выбрать фото" }).click();
    await expect(page).toHaveURL(/\/editor/);
    await page.locator('input[type="file"][multiple]').setInputFiles(FILES);
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 30_000 });
    await page.waitForTimeout(1500); // черновик пишется в IndexedDB с задержкой (lib/draft.js) — до перезагрузок
    await page.reload();
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 30_000 });

    await test.step("на сервере новая версия → воркер новой версии ставится → тост «Есть новая версия»", async () => {
      await context.route("**/*", async (route) => {
        const res = await route.fetch();
        const html = (res.headers()["content-type"] || "").includes("text/html");
        await route.fulfill({ response: res, headers: html ? { ...res.headers(), "x-app-version": NEXT } : res.headers() });
      });
      await page.reload();
      await expect
        .poll(() => page.evaluate(async () => (await caches.match("/__picpac/latest-version", { cacheName: "picpac-meta" }))?.text() ?? null), { timeout: 30_000 })
        .toBe(NEXT);
      await page.reload();
      await expect(page.locator(".pwa-update")).toContainText("Есть новая версия", { timeout: 90_000 });
      await context.unrouteAll({ behavior: "wait" });
    });

    await test.step("без сети «Обновить» → страница новой версии из кэша: фото, перетаскивание, «Правки»", async () => {
      await setOfflineAll(context, true);
      await page.locator(".pwa-update").getByRole("button", { name: "Обновить" }).click();
      // Страница перезагружается сама (смена воркера) — пока она грузится, evaluate может оборваться
      const controller = () => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || "").catch(() => "");
      await expect.poll(controller, { timeout: 60_000 }).toContain("v=" + NEXT);
      await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 30_000 });
      await page.getByRole("button", { name: "Правки", exact: true }).click();
      await expect(page.getByRole("list", { name: "Фото проекта" })).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("[data-offline-step]")).toHaveCount(0);
      await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    });

    await setOfflineAll(context, false);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("кусок «Правок» не скачан", () => {
  // Без сервис-воркера маршрут видит все запросы страницы: кусок «Правок» (PhotoEditor) не отдаём — как будто
  // «Правки» ни разу не открывали с сетью и прогреть не успели
  test.use({ serviceWorkers: "block" });

  test("«Правки» без сети — понятный текст вместо «Что-то пошло не так», остальные шаги работают", async ({ page, context }) => {
    test.setTimeout(180_000);
    let blocked = 0;
    await context.route(/\/_next\/static\/chunks\/.+\.js/, async (route) => {
      const res = await route.fetch();
      const body = await res.text();
      if (body.includes("pe-select-row")) {
        blocked++;
        return route.abort("internetdisconnected");
      }
      return route.fulfill({ response: res, body });
    });

    await page.goto("/product/photo");
    await page.getByRole("button", { name: "Выбрать фото" }).click();
    await expect(page).toHaveURL(/\/editor/);
    await page.locator('input[type="file"][multiple]').setInputFiles(FILES);
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2, { timeout: 30_000 });

    await context.setOffline(true);
    await page.getByRole("button", { name: "Правки", exact: true }).click();
    const note = page.locator("[data-offline-step]");
    await expect(note).toBeVisible({ timeout: 20_000 });
    await expect(note).toContainText("Без сети этот шаг пока недоступен — откройте его, когда появится связь");
    await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    expect(blocked, "кусок «Правок» запрошен и не отдан").toBeGreaterThan(0);

    // «Повторить» без сети — тот же понятный текст; другие шаги работают
    await note.getByRole("button", { name: "Повторить" }).click();
    await expect(page.locator("[data-offline-step]")).toBeVisible();
    await page.getByRole("button", { name: "Проверка", exact: true }).click();
    await expect(page.getByText("Что-то пошло не так")).toHaveCount(0);
    await page.getByRole("button", { name: "Фото", exact: true }).click();
    await expect(page.locator(".photo-cell[data-photo]")).toHaveCount(2);
    await context.setOffline(false);
  });
});
