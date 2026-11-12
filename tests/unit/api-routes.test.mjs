// lib/apiRoutes.js (proxy.js: JSON 404/405 для /api) совпадает с файлами app/api/**/route.js; CSP строгая
import assert from "node:assert/strict";
import { test } from "node:test";
import { API_ROUTES } from "../../lib/apiRoutes.js";
import { buildCsp } from "../../lib/server/csp.js";
import { buildRoutes } from "../../scripts/gen-api-routes.mjs";

test("список маршрутов API для proxy.js актуален (иначе: node scripts/gen-api-routes.mjs)", () => {
  assert.deepEqual(API_ROUTES, buildRoutes());
  assert.ok(API_ROUTES.length >= 28);
  assert.ok(API_ROUTES.every((r) => r.methods.length > 0));
});

test("CSP: скрипты только с nonce, без unsafe-inline/unsafe-eval в продакшене, frame-ancestors none", () => {
  const csp = buildCsp("abc", { https: true, supabase: "https://x.supabase.co" });
  const script = csp.split("; ").find((d) => d.startsWith("script-src"));
  assert.match(script, /'nonce-abc'/);
  assert.match(script, /'strict-dynamic'/);
  assert.doesNotMatch(script, /unsafe-inline|'unsafe-eval'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /connect-src 'self' data: blob: https:\/\/x\.supabase\.co/);
  assert.match(csp, /upgrade-insecure-requests/);
  assert.doesNotMatch(buildCsp("abc", {}), /upgrade-insecure-requests/);
  // Панель Vercel — только на превью; на основном сайте рамки запрещены
  assert.match(csp, /frame-src 'none'/);
  assert.doesNotMatch(csp, /vercel\.live/);
  assert.match(buildCsp("abc", { preview: true }), /frame-src https:\/\/vercel\.live/);
});
