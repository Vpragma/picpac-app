// Список маршрутов /api и их методов для proxy.js: неизвестный адрес → JSON 404, неверный метод → JSON 405.
// Запуск: node scripts/gen-api-routes.mjs (unit-тест tests/unit/api-routes.test.mjs сверяет файл с кодом).
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name === "route.js") out.push(p);
  }
  return out;
}

export function buildRoutes() {
  return walk(join(ROOT, "app", "api"))
    .map((file) => {
      const src = readFileSync(file, "utf8");
      const methods = METHODS.filter((m) => new RegExp(`export\\s+(async\\s+)?function\\s+${m}\\b|export\\s+const\\s+${m}\\b|export\\s*\\{[^}]*\\b${m}\\b`).test(src));
      const parts = relative(join(ROOT, "app"), file).split(sep).slice(0, -1);
      const pattern = "^/" + parts.map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/") + "/?$";
      return { pattern, methods };
    })
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}

export function renderRoutes(routes) {
  return `// Создано scripts/gen-api-routes.mjs — не править руками.\nexport const API_ROUTES = ${JSON.stringify(routes, null, 2)};\n`;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split(sep).pop())) {
  writeFileSync(join(ROOT, "lib", "apiRoutes.js"), renderRoutes(buildRoutes()));
  console.log("lib/apiRoutes.js:", buildRoutes().length, "маршрутов");
}
