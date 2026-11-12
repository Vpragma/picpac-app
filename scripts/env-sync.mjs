// Дополняет .env.local переменными из Vercel (окружение development).
// Существующие ключи не трогает (иначе пропадут локальные, например SEED_PASSWORD),
// временный файл удаляет, на экран выводит только имена — без значений.
// Запуск: npm run env:sync
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, appendFileSync, rmSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const local = join(root, ".env.local");
const tmpDir = mkdtempSync(join(tmpdir(), "picpac-env-"));
const tmp = join(tmpDir, ".env.vercel");

// Имя ключа из строки вида KEY=value (комментарии и пустые строки пропускаем)
const keyOf = (line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];

// Имена, которые нужны ночной работе (печатаем, каких не хватает)
const REQUIRED = [
  "SUPABASE_URL",
  ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  "NEXT_PUBLIC_SUPABASE_URL",
  "POSTGRES_URL_NON_POOLING",
  "SEED_PASSWORD_CLIENT",
  "SEED_PASSWORD_MODERATOR",
  "SEED_PASSWORD_ADMIN",
];

// Vercel CLI стоит в ~/.npm-global/bin, который есть не в каждой оболочке
const globalBin = join(homedir(), ".npm-global", "bin", "vercel");
const vercel = existsSync(globalBin) ? globalBin : "vercel";

try {
  execFileSync(vercel, ["env", "pull", tmp, "--environment=development", "--yes"], {
    cwd: root,
    stdio: ["ignore", "ignore", "pipe"],
  });
  const have = new Set(existsSync(local) ? readFileSync(local, "utf8").split("\n").map(keyOf).filter(Boolean) : []);
  const added = [];
  const lines = readFileSync(tmp, "utf8").split("\n");
  let out = "";
  for (const line of lines) {
    const key = keyOf(line);
    // Служебный токен Vercel CLI локально не нужен
    if (!key || have.has(key) || key === "VERCEL_OIDC_TOKEN") continue;
    out += line + "\n";
    have.add(key);
    added.push(key);
  }
  if (out) appendFileSync(local, (existsSync(local) ? "\n" : "") + out);
  console.log(added.length ? `Добавлены ключи: ${added.join(", ")}` : "Новых ключей нет.");

  const missing = REQUIRED.filter((k) => (Array.isArray(k) ? !k.some((x) => have.has(x)) : !have.has(k)))
    .map((k) => (Array.isArray(k) ? k.join(" или ") : k));
  console.log(missing.length ? `Не хватает: ${missing.join(", ")}` : "Все нужные ключи на месте.");
  if (missing.length) process.exitCode = 1;
} catch (e) {
  // Текст ошибки CLI не печатаем целиком — в нём может оказаться значение
  console.error("Не удалось получить переменные из Vercel:", e?.status ?? "", String(e?.stderr || "").split("\n")[0].slice(0, 200));
  process.exitCode = 1;
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
