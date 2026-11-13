// N6: защитные заголовки — на страницах и в API, включая ответы proxy.js (401, 404, 405). Содержимое CSP здесь
// не проверяем (её меняет трек локального ИИ), только что она есть у страниц.
// Запуск: npm run test:api (сервер на BASE_URL).
import assert from "node:assert/strict";
import { test } from "node:test";
import { BASE } from "../helpers/client.mjs";

const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const get = (path, method = "GET") =>
  fetch(BASE + path, { method, redirect: "manual", headers: BYPASS ? { "x-vercel-protection-bypass": BYPASS } : {} });

// Обязательные для любого ответа приложения
const COMMON = {
  "x-content-type-options": (v) => v === "nosniff",
  "referrer-policy": (v) => v === "strict-origin-when-cross-origin",
  "x-frame-options": (v) => v === "DENY",
  "strict-transport-security": (v) => /max-age=(\d+)/.test(v) && Number(v.match(/max-age=(\d+)/)[1]) >= 31536000,
  "permissions-policy": (v) => /camera=\(\)/.test(v) && /geolocation=\(\)/.test(v) && /microphone=\(\)/.test(v),
  "cross-origin-opener-policy": (v) => v === "same-origin",
  "cross-origin-resource-policy": (v) => v === "same-origin",
  "x-permitted-cross-domain-policies": (v) => v === "none",
};

function check(res, extra = {}) {
  const bad = [];
  for (const [name, ok] of Object.entries({ ...COMMON, ...extra })) {
    const v = res.headers.get(name);
    if (v == null || !ok(v)) bad.push(`${name}: ${v ?? "нет"}`);
  }
  if (res.headers.get("x-powered-by")) bad.push("x-powered-by: есть (выдаёт сервер)");
  return bad;
}

const CASES = [
  ["/", "GET", 200, { "content-security-policy": (v) => /default-src/.test(v) }],
  ["/product/layflat", "GET", 200, { "content-security-policy": (v) => /default-src/.test(v) }],
  ["/admin", "GET", 401, { "content-security-policy": (v) => /default-src/.test(v), "cache-control": (v) => /no-store/.test(v) }],
  ["/api/v1/catalog", "GET", 200, {}],
  ["/api/v1/orders", "GET", 401, { "cache-control": (v) => /no-store/.test(v) }],
  ["/api/v1/admin/audit", "GET", 401, { "cache-control": (v) => /no-store/.test(v), "x-request-id": (v) => v.length >= 8 }],
  ["/api/v1/nope", "GET", 404, { "cache-control": (v) => /no-store/.test(v), "x-request-id": (v) => v.length >= 8 }],
  ["/api/v1/catalog", "DELETE", 405, { allow: (v) => /GET/.test(v) }],
];

for (const [path, method, status, extra] of CASES) {
  test(`заголовки: ${method} ${path} → ${status}`, async () => {
    const res = await get(path, method);
    assert.equal(res.status, status, `${method} ${path}: код ${res.status}`);
    const bad = check(res, extra);
    assert.deepEqual(bad, [], `${method} ${path}: ` + bad.join("; "));
  });
}

test("заголовки: сервис-воркер — своя строгая CSP и без кэша", async () => {
  const res = await get("/sw.js");
  assert.equal(res.status, 200);
  assert.deepEqual(check(res, { "cache-control": (v) => /no-store/.test(v), "content-security-policy": (v) => /default-src 'self'/.test(v) }), []);
});
