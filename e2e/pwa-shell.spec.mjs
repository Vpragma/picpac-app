// N5 · повторный вход: оболочка из кэша сервис-воркера сразу (копия той же версии сборки, свежая — в фоне);
// новая версия на сервере (заголовок X-App-Version) → воркер новой версии ставится и ждёт → тост «Есть новая версия — Обновить».
// Только гость: аккаунты не создаются. Запросы самого воркера Playwright перехватывает маршрутом контекста.
import { expect, test } from "@playwright/test";

const NEXT = "e2e-next-version";

async function shellCached(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) return false;
    const name = (await caches.keys()).find((k) => k.startsWith("picpac-pages-"));
    return !!name && !!(await (await caches.open(name)).match(location.origin + "/"));
  });
}

test("PWA: повторный вход — оболочка из кэша сразу, новая версия — тост «Обновить»", async ({ page, context }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text());
  });

  await test.step("первый визит: воркер ставится и сохраняет оболочку", async () => {
    await page.goto("/");
    await expect.poll(() => shellCached(page), { timeout: 90_000 }).toBe(true);
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  });

  await test.step("сеть медленная (6 с на страницу): главная всё равно открывается сразу — из кэша", async () => {
    let slowed = 0;
    await context.route(
      (url) => url.pathname === "/",
      async (route) => {
        slowed++;
        await new Promise((r) => setTimeout(r, 6000));
        await route.continue().catch(() => {});
      },
    );
    const t0 = Date.now();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const ms = Date.now() - t0;
    // Раньше (сначала сеть) воркер ждал 4 с и только потом отдавал копию
    expect(ms, `главная открылась за ${ms} мс`).toBeLessThan(3500);
    expect(slowed, "свежая копия всё равно запрошена в фоне").toBeGreaterThan(0);
    await context.unrouteAll({ behavior: "wait" }); // дождаться фонового запроса воркера
  });

  await test.step("на сервере новая версия: воркер новой версии ждёт → тост «Обновить» → обновление", async () => {
    // Все HTML-ответы сервера — «новой сборки» (как после выкладки); остальное — без изменений
    await context.route("**/*", async (route) => {
      const res = await route.fetch();
      const html = (res.headers()["content-type"] || "").includes("text/html");
      await route.fulfill({ response: res, headers: html ? { ...res.headers(), "x-app-version": NEXT } : res.headers() });
    });
    await page.goto("/");
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const hit = await caches.match("/__picpac/latest-version", { cacheName: "picpac-meta" });
            return hit ? hit.text() : null;
          }),
        { timeout: 30_000 },
      )
      .toBe(NEXT);
    await page.reload();
    const toast = page.locator(".pwa-update");
    await expect(toast).toContainText("Есть новая версия", { timeout: 90_000 });
    await toast.getByRole("button", { name: "Обновить" }).click();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || ""), { timeout: 60_000 }).toContain("v=" + NEXT);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await context.unrouteAll({ behavior: "wait" });
  });

  expect(errors).toEqual([]);
});
