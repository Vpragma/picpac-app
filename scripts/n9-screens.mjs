// N9: ручная проверка админки скриптом (Playwright, Chrome headless): экраны 390×844 и 1440×900, светлая и тёмная тема,
// ошибки консоли, горизонтальная прокрутка, axe (серьёзные и критические). Вход — свой тестовый админ night2-n9-…@example.com
// (создаётся и удаляется скриптом, пароль нигде не печатается). Только на своём сервере 127.0.0.1.
// Запуск: BASE_URL=http://127.0.0.1:3306 node --env-file=.env.local scripts/n9-screens.mjs [папка для снимков]
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "@playwright/test";
import { deleteTestUser, supabaseAdmin } from "../tests/helpers/client.mjs";

const BASE = (process.env.BASE_URL || "http://127.0.0.1:3306").replace(/\/$/, "");
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(BASE)) throw new Error("Только свой локальный сервер 127.0.0.1");
const OUT = process.argv[2] || ".night-logs/n9-screens";
mkdirSync(OUT, { recursive: true });

const admin = supabaseAdmin();
const email = `night2-n9-screens-${randomUUID().slice(0, 8)}@example.com`;
const password = randomBytes(18).toString("base64url");
const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Night2 Проверка" } });
if (error) throw error;
const user = { id: data.user.id, email };
await admin.from("user_roles").delete().eq("user_id", user.id).eq("role", "client");
await admin.from("user_roles").upsert({ user_id: user.id, role: "admin" });

const { data: anyOrder } = await admin.from("orders").select("id").eq("status", "moderation").limit(1);
const PAGES = [
  ["audit", "/admin/audit"],
  ["audit-tests", "/admin/audit?tests=1&erp=1&system=1"],
  ["orders", "/admin/orders"],
  ["orders-overdue", "/admin/orders?overdue=1&sort=eta"],
  ...(anyOrder?.[0] ? [["order-card", `/admin/orders/${anyOrder[0].id}`]] : []),
  ["users", "/admin/users"],
  ["catalog", "/admin/catalog"],
  ["stats", "/admin/stats"],
  ["overview", "/admin"],
];
const SIZES = [
  ["phone", { width: 390, height: 844 }],
  ["desktop", { width: 1440, height: 900 }],
];
const report = [];
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const theme of ["light", "dark"]) {
    for (const [sizeName, viewport] of SIZES) {
      const ctx = await browser.newContext({ viewport, locale: "ru-RU", timezoneId: "Europe/Minsk", deviceScaleFactor: 1 });
      await ctx.addCookies([{ name: "pp_theme", value: theme, url: BASE }]);
      await ctx.addInitScript(() => {
        try {
          localStorage.setItem("pp:onboarding", "done");
        } catch {}
      });
      const login = await ctx.request.post(BASE + "/api/v1/auth/login", { data: { email, password } });
      if (login.status() !== 200) throw new Error("Вход: " + login.status());
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
      for (const [name, path] of PAGES) {
        errors.length = 0;
        const t0 = Date.now();
        const res = await page.goto(BASE + path, { waitUntil: "networkidle" });
        const ms = Date.now() - t0;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        const bad = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
        await page.screenshot({ path: `${OUT}/${theme}-${sizeName}-${name}.png`, fullPage: false });
        report.push({ theme, size: sizeName, page: name, status: res?.status(), ms, overflow, console: [...errors], axe: bad.map((v) => `${v.id}(${v.nodes.length}): ${v.nodes[0]?.target?.join(" ")}`) });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await deleteTestUser(admin, user);
}
let problems = 0;
for (const r of report) {
  const issues = [r.status !== 200 && `код ${r.status}`, r.overflow > 0 && `прокрутка вбок ${r.overflow}px`, r.console.length && `консоль: ${r.console.join(" | ")}`, r.axe.length && `axe: ${r.axe.join("; ")}`].filter(Boolean);
  if (issues.length) problems++;
  console.log(`${issues.length ? "✖" : "✓"} ${r.theme} ${r.size} ${r.page} ${r.ms}мс${issues.length ? " — " + issues.join(" · ") : ""}`);
}
console.log(`Экранов: ${report.length}, с замечаниями: ${problems}`);
process.exitCode = problems ? 1 : 0;
