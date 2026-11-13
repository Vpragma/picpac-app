// N2 · доступность сезонных элементов: промо-плашка и баннер каждого сезона (контраст AA и все правила WCAG A/AA),
// в светлой и тёмной теме; страница админки «Сезон». Условие: 0 серьёзных и критических нарушений, контраст — 0 нарушений.
// Временный админ e2e-…@example.com создаётся и удаляется; сезон после теста возвращается к исходному.
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";
import { smallTargets } from "./helpers.mjs";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
let admin;
let staff;
let original = "autumn";

test.beforeAll(async ({}, info) => {
  admin = supabaseAdmin();
  const { data } = await admin.from("site_season").select("season").eq("id", true).maybeSingle();
  original = data?.season || "autumn";
  staff = await createTestUser(admin, ["admin"], "e2e-a11yseason" + info.parallelIndex + Date.now().toString(36).slice(-4));
});

test.afterAll(async () => {
  if (staff) {
    await staff.client.req("/api/v1/admin/season", { method: "PUT", body: { season: original } });
    await deleteTestUser(admin, staff);
  }
  staff = null;
});

function report(result) {
  const bad = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical" || v.id === "color-contrast");
  return bad.map((v) => `${v.impact} ${v.id}: ${v.help} — ${v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n").pop() || ""}`).join(" | ")}`);
}

for (const season of ["autumn", "blackfriday", "newyear"]) {
  test(`сезон ${season}: плашка и баннер — контраст AA, нет серьёзных нарушений (светлая и тёмная тема)`, async ({ page }) => {
    const r = await staff.client.req("/api/v1/admin/season", { method: "PUT", body: { season } });
    expect(r.status, r.text).toBe(200);
    for (const scheme of ["light", "dark"]) {
      await page.context().addCookies([{ name: "pp_theme", value: scheme, url: test.info().project.use.baseURL }]);
      await page.goto("/", { waitUntil: "load" });
      await expect(page.locator("html")).toHaveAttribute("data-season", season);
      await expect(page.locator("html")).toHaveAttribute("data-color-scheme", scheme);
      const banner = page.getByTestId("season-banner");
      await banner.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const result = await new AxeBuilder({ page }).include("[data-testid=season-banner]").include("[data-testid=season-promo]").withTags(TAGS).analyze();
      const bad = report(result);
      expect(bad, `${season}, ${scheme}:\n` + bad.join("\n")).toEqual([]);
      // ручная проверка контраста не нужна: текст — сплошной цвет на сплошном фоне
      const manual = result.incomplete.filter((v) => v.id === "color-contrast").flatMap((v) => v.nodes.map((n) => n.target.join(" ")));
      expect(manual, manual.join("\n")).toEqual([]);
      expect(await smallTargets(page).then((list) => list.filter((t) => /Смотреть|Собрать|Выбрать/.test(t)))).toEqual([]);
    }
  });
}

test("админка «Сезон»: нет серьёзных нарушений, варианты выбираются с клавиатуры", async ({ page }) => {
  await page.goto("/login?next=/admin/season");
  await page.getByLabel("Почта").fill(staff.email);
  await page.getByLabel("Пароль", { exact: true }).fill(staff.password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/season$/);
  await expect(page.getByTestId("season-panel")).toBeVisible();
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = report(result);
  expect(bad, bad.join("\n")).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  // клавиатура: стрелки переключают радиокнопки сезона
  const radios = page.getByRole("radio");
  await expect(radios).toHaveCount(4);
  await radios.nth(0).focus();
  await page.keyboard.press("ArrowRight");
  await expect(radios.nth(1)).toBeChecked();
});
