// S07 · приложение (PWA): манифест и иконки, сервис-воркер активен, без сети — понятный экран «Нет сети»,
// черновик гостя открывается без сети (оболочка из кэша, фото из IndexedDB), прямая ссылка на проект /editor?project=…
// Только гость: аккаунты не создаются.
import { expect, test } from "@playwright/test";

const GALLERY = ["mir-castle", "bison", "dog"];

async function pickFromGallery(page, files) {
  await page.getByRole("button", { name: "Тестовая галерея" }).click();
  const gallery = page.getByRole("region", { name: "Тестовая галерея" });
  await expect(gallery.locator("input[type=checkbox]").first()).toBeVisible();
  await gallery.getByRole("button", { name: "Снять выбор" }).click();
  for (const f of files) await gallery.locator(`label[data-file="${f}.jpg"] input[type=checkbox]`).check();
  await gallery.getByRole("button", { name: `Добавить ${files.length} фото` }).click();
}

// Без сети: context.setOffline — для страницы (navigator.onLine, события offline); запросы самого сервис-воркера
// эмуляция Playwright накрывает не всегда (воркер перезапускается), поэтому ещё и обрываем все запросы маршрутом —
// он действует и на запросы сервис-воркера.
async function setOfflineAll(context, offline) {
  await context.setOffline(offline);
  if (offline) await context.route("**/*", (route) => route.abort("internetdisconnected"));
  else await context.unrouteAll({ behavior: "ignoreErrors" });
}

test("PWA: манифест, сервис-воркер, офлайн-экран, черновик без сети, ссылка на проект", async ({ page, context }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) errors.push(m.text());
  });

  await test.step("манифест и иконки", async () => {
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m).toMatchObject({ short_name: "PicPac", lang: "ru", display: "standalone", start_url: "/", scope: "/" });
    expect(m.icons.some((i) => i.purpose === "maskable" && i.sizes === "512x512")).toBeTruthy();
    expect(m.icons.some((i) => i.sizes === "192x192")).toBeTruthy();
    for (const i of m.icons) expect((await page.request.get(i.src)).ok(), i.src).toBeTruthy();
    const sw = await page.request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toContain("no-cache");
  });

  await test.step("сервис-воркер активен и управляет страницей, оболочка в кэше", async () => {
    await page.goto("/");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60_000 });
    await page.waitForFunction(
      async () => {
        const name = (await caches.keys()).find((k) => k.startsWith("picpac-pages-"));
        if (!name) return false;
        const c = await caches.open(name);
        return !!(await c.match(location.origin + "/books")) && !!(await c.match(location.origin + "/editor")) && !!(await caches.match("/offline.html"));
      },
      null,
      { timeout: 60_000 },
    );
  });

  let projectId;
  await test.step("гость: черновик с фото", async () => {
    await page.locator('a[href="/product/photopaper-book"]').first().click();
    await page.getByRole("button", { name: "Создать фотокнигу" }).click();
    await expect(page).toHaveURL(/\/editor/);
    await pickFromGallery(page, GALLERY);
    await expect(page.locator(".photo-cell img")).toHaveCount(GALLERY.length, { timeout: 120_000 });
    await page.waitForTimeout(500); // черновик пишется в IndexedDB не позже 0,15 с
    projectId = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open("picpac");
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const tx = req.result.transaction("kv", "readonly");
            tx.objectStore("kv").get("currentId").onsuccess = (e) => resolve(e.target.result);
          };
        }),
    );
    expect(projectId).toBeTruthy();
  });

  await test.step("без сети: плашка «Нет сети», черновик открывается, неизвестная страница — экран «Нет сети»", async () => {
    await setOfflineAll(context, true);
    await expect(page.locator(".net-banner")).toContainText("Нет сети");
    await page.goto("/books");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goto("/editor?project=" + encodeURIComponent(projectId));
    await expect(page.locator(".photo-cell img")).toHaveCount(GALLERY.length, { timeout: 30_000 });
    await page.goto("/orders/00000000-0000-4000-8000-000000000000");
    await expect(page.getByRole("heading", { name: "Нет сети" })).toBeVisible();
    await expect(page.getByText("Черновики сохранены на устройстве")).toBeVisible();
    await page.getByRole("link", { name: /Мои книги/ }).click();
    await expect(page).toHaveURL(/\/books$/);
    await setOfflineAll(context, false);
  });

  await test.step("прямая ссылка на чужой (несуществующий) проект — понятный экран со входом", async () => {
    await page.goto("/editor?project=nope-" + Date.now());
    await expect(page.getByRole("heading", { name: "Проект не найден на этом устройстве" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Войти" })).toHaveAttribute("href", /\/login\?next=%2Feditor%3Fproject%3Dnope-/);
  });

  expect(errors).toEqual([]);
});
