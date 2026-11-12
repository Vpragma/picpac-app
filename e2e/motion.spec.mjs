// N2 · микровзаимодействия: «полёт» миниатюры в корзину, переход между шагами редактора, появление карточек каталога.
// Только transform и opacity; при prefers-reduced-motion — без движения. Без входа, без записи в базу.
import { expect, test } from "@playwright/test";

// 1×1 JPEG-«обложка», как миниатюра из редактора (data:-адрес)
const COVER =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

test("«В корзину»: миниатюра летит к значку корзины и исчезает; при reduced-motion — не летит", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("/help");
  await expect(page.locator(".topbar .cart-btn")).toBeVisible();
  await page.waitForLoadState("networkidle"); // обработчик события ставится после гидратации
  // нажатие (точка старта) и событие «добавлено в корзину» — его шлёт lib/cart.js
  await page.mouse.click(200, 500);
  await page.evaluate((cover) => window.dispatchEvent(new CustomEvent("picpac-cart-add", { detail: { cover } })), COVER);
  const fly = page.locator(".fly-thumb");
  await expect(fly).toHaveCount(1);
  const st = await fly.evaluate((el) => ({ pos: getComputedStyle(el).position, pe: getComputedStyle(el).pointerEvents, src: el.getAttribute("src")?.slice(0, 15) }));
  expect(st).toEqual({ pos: "fixed", pe: "none", src: "data:image/jpeg" });
  await expect(fly).toHaveCount(0, { timeout: 3000 });

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.click(200, 500);
  await page.evaluate((cover) => window.dispatchEvent(new CustomEvent("picpac-cart-add", { detail: { cover } })), COVER);
  await page.waitForTimeout(300);
  await expect(page.locator(".fly-thumb")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("редактор: новый шаг мягко въезжает (без правок логики редактора); карточки каталога появляются плавно", async ({ page }) => {
  await page.goto("/product/photo");
  await page.getByRole("button", { name: "Выбрать фото" }).click();
  await expect(page).toHaveURL(/\/editor/);
  const steps = page.getByRole("navigation", { name: "Шаги редактора" });
  await expect(steps).toBeVisible();
  await steps.getByRole("button", { name: "Проверка" }).click();
  await expect(steps.getByRole("button", { name: "Проверка" })).toHaveAttribute("aria-current", "step");
  const anim = await page.evaluate(() => {
    const el = document.querySelector("nav.steps + *");
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: parseFloat(cs.animationDuration) };
  });
  expect(anim.name).toBe("pp-step-in");
  expect(anim.dur).toBeGreaterThan(0.1);
  expect(anim.dur).toBeLessThan(0.5);

  await page.goto("/");
  const card = page.locator(".catalog-grid > *").first();
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).animationName)).toBe("pp-rise");
  // после появления наведение снова поднимает карточку (анимация не держит transform)
  expect(await card.evaluate((el) => getComputedStyle(el).animationFillMode)).toBe("backwards");
});
