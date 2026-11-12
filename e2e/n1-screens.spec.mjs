// N1: проход по экранам клиента и админки на телефоне 390×844 и компьютере 1440×900, светлая и тёмная тема.
// Снимки — для проверки глазами и для презентации «стало»: docs/presentation/screens-v2/before-after/after-…
// Не входит в обычный прогон: только с N1SCREENS=1. Вход — временные пользователи e2e-…@example.com (клиент, модератор,
// админ), после прохода удаляются. Только на своём сервере: N1SCREENS=1 BASE_URL=http://127.0.0.1:<порт> npx playwright test e2e/n1-screens.spec.mjs
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const OUT = path.resolve("docs/presentation/screens-v2/before-after");
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } };

test.describe("N1 экраны", () => {
  test.skip(!process.env.N1SCREENS, "только с N1SCREENS=1");
  test.use({ viewport: null });

  for (const [device, viewport] of Object.entries(VIEWPORTS)) {
    test(`${device}: клиент, модератор, админ — светлая и тёмная`, async ({ browser }, info) => {
      test.skip(info.project.name.startsWith("компьютер"), "размеры задаются в самом тесте");
      test.setTimeout(10 * 60_000);
      fs.mkdirSync(OUT, { recursive: true });
      const admin = supabaseAdmin();
      const tag = Date.now().toString(36).slice(-5);
      const users = {
        client: await createTestUser(admin, ["client"], "n1c" + tag),
        moderator: await createTestUser(admin, ["moderator"], "n1m" + tag),
        admin: await createTestUser(admin, ["admin"], "n1a" + tag),
      };
      const base = info.project.use.baseURL;
      const errors = [];
      try {
        for (const [role, pages] of [
          ["client", [["/", "home"], ["/product/photo", "product-photo"], ["/cart", "cart"], ["/orders", "orders"], ["/notifications", "notifications"], ["/profile", "profile"], ["/help", "help"]]],
          ["moderator", [["/admin", "staff-overview"], ["/admin/moderation", "staff-moderation"]]],
          ["admin", [["/admin", "admin-overview"], ["/admin/stats", "admin-stats"], ["/admin/audit", "admin-audit"], ["/admin/notifications", "admin-notifications"], ["/admin/reminders", "admin-reminders"]]],
        ]) {
          for (const theme of ["light", "dark"]) {
            const ctx = await browser.newContext({
              viewport,
              deviceScaleFactor: device === "phone" ? 2 : 1,
              hasTouch: device === "phone",
              locale: "ru-RU",
              timezoneId: "Europe/Minsk",
              baseURL: base,
              storageState: { cookies: [], origins: [{ origin: new URL(base).origin, localStorage: [{ name: "pp:onboarding", value: "done" }] }] },
            });
            await ctx.addCookies([{ name: "pp_theme", value: theme, url: base }]);
            const page = await ctx.newPage();
            page.on("pageerror", (e) => errors.push(`${role} ${e.message}`));
            await page.goto("/login");
            const u = users[role];
            await page.getByLabel("Почта").fill(u.email);
            await page.getByLabel("Пароль", { exact: true }).fill(u.password);
            await page.getByRole("button", { name: "Войти", exact: true }).click();
            await page.waitForURL((url) => !url.pathname.startsWith("/login") || url.pathname.startsWith("/login/role"), { timeout: 60_000 }).catch(() => {});
            if (page.url().includes("/login/role")) {
              const pick = role === "client" ? "Клиент" : role === "moderator" ? "Модератор" : "Администратор";
              await page.getByRole("button", { name: new RegExp(pick) }).first().click().catch(() => {});
              await page.waitForTimeout(1500);
            }
            for (const [p, name] of pages) {
              await page.goto(p, { waitUntil: "load" });
              await page.waitForLoadState("networkidle").catch(() => {});
              await page.waitForTimeout(700);
              const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
              expect(sw, `${p}: горизонтальная прокрутка на ${device}`).toBeLessThanOrEqual(0);
              await page.screenshot({ path: path.join(OUT, `after-${device}${theme === "dark" ? "-dark" : ""}-${name}.jpg`), type: "jpeg", quality: 78 });
            }
            await ctx.close();
          }
        }
      } finally {
        for (const u of Object.values(users)) {
          await admin.from("orders").delete().eq("user_id", u.id);
          await deleteTestUser(admin, u);
        }
      }
      expect(errors, "ошибки на страницах").toEqual([]);
    });
  }
});
