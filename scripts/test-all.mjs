// npm run test:all — весь регресс-набор подряд (docs/night/plan.md, раздел 9):
// lint → build → test:unit → (свой сервер next start на порту 3100, если BASE_URL не задан) → test:api → test:auth → e2e → test:a11y.
// test:mfa не входит: ему нужен отдельный ручной шаг (npm run test:mfa).
// Итог — таблица «шаг · результат · время»; код выхода 1, если хоть один шаг упал.
import { spawn, spawnSync } from "node:child_process";

const external = process.env.BASE_URL?.replace(/\/$/, "");
const PORT = 3100;
const base = external || `http://127.0.0.1:${PORT}`;
const results = [];

function run(name, cmd, args, env = {}) {
  const t = Date.now();
  console.log(`\n=== ${name} ===`);
  const r = spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } });
  results.push({ name, ok: r.status === 0, sec: Math.round((Date.now() - t) / 1000) });
  return r.status === 0;
}

async function waitReady(url, ms = 60_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

run("lint", "npm", ["run", "lint"]);
const built = external ? true : run("build", "npm", ["run", "build"]);
run("test:unit", "npm", ["run", "test:unit"]);

let server = null;
if (!external && built) {
  server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(PORT)], { stdio: "ignore", detached: true });
  if (!(await waitReady(base))) console.error("Сервер не запустился на " + base);
}
const env = { BASE_URL: base, TEST_BASE_URL: base };
try {
  run("test:api", "npm", ["run", "test:api"], env);
  run("test:auth", "npm", ["run", "test:auth", "--", base], env);
  run("e2e", "npm", ["run", "e2e"], env);
  run("test:a11y", "npm", ["run", "test:a11y"], env);
} finally {
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {}
  }
}

console.log("\nИтог test:all (" + base + "):");
for (const r of results) console.log(`  ${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(10)} ${r.sec} с`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
