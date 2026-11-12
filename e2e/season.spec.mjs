// N2 · сезоны: админ переключает сезон → гость видит его (при загрузке и при возврате на вкладку);
// «Без сезона» — сезонных элементов нет; одновременно — элементы только одного сезона; prefers-reduced-motion — без движения.
// Временный админ e2e-…@example.com создаётся и удаляется; сезон после теста возвращается к исходному.
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

let admin;
let staff;
let original = "autumn";

test.beforeAll(async ({}, info) => {
  admin = supabaseAdmin();
  const { data } = await admin.from("site_season").select("season").eq("id", true).maybeSingle();
  original = data?.season || "autumn";
  staff = await createTestUser(admin, ["admin"], "e2e-season" + info.parallelIndex + Date.now().toString(36).slice(-4));
});

test.afterAll(async () => {
  if (staff) {
    await staff.client.req("/api/v1/admin/season", { method: "PUT", body: { season: original } });
    await deleteTestUser(admin, staff);
  }
  staff = null;
});

const setSeason = async (season) => {
  const r = await staff.client.req("/api/v1/admin/season", { method: "PUT", body: { season } });
  expect(r.status, r.text).toBe(200);
};

async function guestPage(browser, info) {
  const base = info.project.use.baseURL;
  const ctx = await browser.newContext({
    baseURL: base,
    viewport: info.project.use.viewport,
    hasTouch: info.project.use.hasTouch,
    locale: "ru-RU",
    storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: "pp:onboarding", value: "done" }] }] },
  });
  return ctx.newPage();
}

async function pickSeason(page, season, label) {
  await page.getByTestId(`season-option-${season}`).click();
  const btn = page.getByRole("button", { name: `Включить «${label}»` });
  await btn.click();
  await expect(page.getByTestId("season-result")).toContainText(season === "none" ? "сезон выключен" : `включён сезон «${label}»`);
  await expect(page.getByTestId("season-current")).toContainText(label);
}

test("админ переключает сезон в админке → гость видит осенний баннер; «Без сезона» — баннера и плашки нет", async ({ page, browser }, info) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await setSeason("none");

  // Админ входит и открывает «Сезон»
  await page.goto("/login?next=/admin/season");
  await page.getByLabel("Почта").fill(staff.email);
  await page.getByLabel("Пароль", { exact: true }).fill(staff.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/season/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Сезон оформления");
  await expect(page.getByRole("link", { name: "Сезон" }).first()).toHaveAttribute("aria-current", "page");
  for (const s of ["none", "autumn", "blackfriday", "newyear"]) await expect(page.getByTestId(`season-option-${s}`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Этот сезон уже включён" })).toBeDisabled();

  // Гость: «Без сезона» — ни плашки, ни баннера, логотип фирменный
  const guest = await guestPage(browser, info);
  guest.on("pageerror", (e) => errors.push("гость: " + e));
  await guest.goto("/");
  await expect(guest.locator("html")).toHaveAttribute("data-season", "none");
  await expect(guest.locator("h1")).toBeVisible();
  await expect(guest.getByTestId("season-banner")).toHaveCount(0);
  await expect(guest.getByTestId("season-promo")).toHaveCount(0);
  expect(await guest.locator(".topbar .logo img").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");

  // Админ включает «Осень»
  await pickSeason(page, "autumn", "Осень");

  // Гость с открытой вкладкой: сезон обновляется при возврате на вкладку (без перезагрузки)
  await expect
    .poll(
      async () => {
        await guest.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        return guest.locator("html").getAttribute("data-season");
      },
      { timeout: 20_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe("autumn");
  const banner = guest.getByTestId("season-banner");
  await expect(banner).toBeVisible();
  await expect(banner.getByRole("heading", { level: 2 })).toHaveText("Осень в фотокниге");
  await expect(guest.getByTestId("season-promo")).toBeVisible();

  // Новый гость: осень приходит сразу с сервера (атрибут в первом HTML — без мигания)
  const fresh = await guestPage(browser, info);
  await fresh.goto("/");
  const html = await (await fresh.request.get("/")).text();
  expect(html).toMatch(/<html[^>]*data-season="autumn"/);
  const b2 = fresh.getByTestId("season-banner");
  await expect(b2).toBeVisible();
  // коллаж: фото с размерами и ленивой загрузкой (LCP первого экрана не трогаем)
  const imgs = b2.locator(".sb-print img");
  await expect(imgs).toHaveCount(3);
  for (const i of [0, 1, 2]) {
    await expect(imgs.nth(i)).toHaveAttribute("loading", "lazy");
    await expect(imgs.nth(i)).toHaveAttribute("width", /\d+/);
  }
  // листопад — только внутри баннера
  expect(await fresh.locator(".sb-leaf").count()).toBeGreaterThan(3);
  expect(await fresh.locator(".sb-leaf").evaluateAll((els) => els.every((el) => el.closest("[data-testid=season-banner]")))).toBe(true);
  // логотип — та же форма в цвете осени (терракота); кнопка баннера — фирменная
  expect(await fresh.locator(".topbar .logo picture").evaluate((el) => getComputedStyle(el, "::after").backgroundColor)).toBe("rgb(185, 92, 58)");
  expect(await b2.locator(".btn-primary").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(189, 52, 52)");
  // фон страницы и текст интерфейса — фирменные
  expect(await fresh.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(250, 245, 237)");
  // элементы только одного сезона
  expect(new Set(await fresh.locator("[data-for]").evaluateAll((els) => els.map((e) => e.dataset.for)))).toEqual(new Set(["autumn"]));

  // Админ выключает сезон — у гостя после возврата на вкладку сезонных элементов нет
  await pickSeason(page, "none", "Без сезона");
  await expect
    .poll(
      async () => {
        await fresh.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
        return fresh.locator("html").getAttribute("data-season");
      },
      { timeout: 20_000, intervals: [1_000, 2_000, 5_000] },
    )
    .toBe("none");
  await expect(fresh.getByTestId("season-banner")).toHaveCount(0);
  await expect(fresh.getByTestId("season-promo")).toHaveCount(0);

  // «Чёрная пятница» и «Новый год» — свой баннер и плашка, без элементов осени
  for (const [s, title] of [
    ["blackfriday", "Чёрная пятница"],
    ["newyear", "Новый год в фотокниге"],
  ]) {
    await setSeason(s);
    await fresh.goto("/");
    await expect(fresh.getByTestId("season-banner").getByRole("heading", { level: 2 })).toHaveText(title);
    expect(new Set(await fresh.locator("[data-for]").evaluateAll((els) => els.map((e) => e.dataset.for)))).toEqual(new Set([s]));
    await expect(fresh.locator(".sb-leaf")).toHaveCount(0);
  }
  expect(errors).toEqual([]);
  await guest.context().close();
  await fresh.context().close();
});

test("prefers-reduced-motion: листопад стоит, на странице нет анимаций и переходов", async ({ page }) => {
  await setSeason("autumn");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const leaves = page.locator(".sb-leaf");
  await expect(leaves.first()).toBeAttached();
  expect(new Set(await leaves.evaluateAll((els) => els.map((e) => getComputedStyle(e).animationName)))).toEqual(new Set(["none"]));
  const moving = await page.evaluate(() => {
    const ms = (v) => Math.max(...v.split(",").map((x) => parseFloat(x) * (x.trim().endsWith("ms") ? 1 : 1000)));
    return [...document.querySelectorAll("*")]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.animationName !== "none" && ms(cs.animationDuration) > 1) || ms(cs.transitionDuration) > 1;
      })
      .map((el) => el.tagName + "." + el.className);
  });
  expect(moving).toEqual([]);
  // без настройки — листья падают, карточки каталога появляются плавно
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect(await leaves.first().evaluate((e) => getComputedStyle(e).animationName)).toBe("sb-fall");
  expect(await page.locator(".catalog-grid > *").first().evaluate((e) => getComputedStyle(e).animationName)).toBe("pp-rise");
});
