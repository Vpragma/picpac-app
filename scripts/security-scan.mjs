// npm run security:scan — поиск секретов (SEC-02, SEC-12) и сводка npm audit (SEC-11).
// Где ищем: файлы репозитория (git ls-files), вся история git (все ветки и теги), собранный фронтенд .next/static.
// Что ищем: шаблоны ключей и сами значения секретов из .env.local (сравнение без вывода значений).
// Печатает только имя шаблона и место находки — никогда не сам секрет. Находки → код выхода 1.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PATTERNS = [
  ["ключ Supabase sb_secret_", /sb_secret_[A-Za-z0-9_-]{10,}/g],
  ["JWT (eyJhbGci…)", /eyJhbGciOi[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g],
  // Пароль в адресе — только ASCII (настоящие пароли такие); описания вроде «postgres://…:пароль@» в документах не считаются
  ["адрес Postgres с паролем", /postgres(?:ql)?:\/\/[A-Za-z0-9._%-]+:[A-Za-z0-9._~%!$&*+,;=-]{6,}@/g],
  ["закрытый ключ -----BEGIN", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["VAPID_PRIVATE_KEY=значение", /VAPID_PRIVATE_KEY\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/g],
  ["CLOUDFLARE_API_TOKEN=значение", /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/g],
];
// Значения настоящих секретов (если есть .env.local) — ищем их буквально
const SECRET_NAMES = ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_JWT_SECRET", "POSTGRES_PASSWORD", "POSTGRES_URL", "CLOUDFLARE_API_TOKEN", "VAPID_PRIVATE_KEY", "CRON_SECRET", "ERP_SECRET", "ANALYTICS_SALT", "SEED_PASSWORD", "SEED_PASSWORD_CLIENT", "SEED_PASSWORD_MODERATOR", "SEED_PASSWORD_ADMIN"];
const secrets = SECRET_NAMES.map((n) => [n, process.env[n]]).filter(([, v]) => v && v.length >= 12);
// Пароли демо-аккаунтов жюри (SEED_PASSWORD_CLIENT / _MODERATOR / _ADMIN) опубликованы в README намеренно — по нему жюри входит в прототип.
// В репозитории и истории его не считаем находкой, во фронтенде (.next/static) — считаем.
const PUBLIC_IN_REPO = new Set(["SEED_PASSWORD", "SEED_PASSWORD_CLIENT", "SEED_PASSWORD_MODERATOR", "SEED_PASSWORD_ADMIN"]);

// JWT с ролью anon — публичный ключ (его можно показывать), service_role — секрет
function jwtIsPublic(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.role === "anon" || payload.role === "authenticated";
  } catch {
    return false;
  }
}

function scanText(text, where, found, { repo = false } = {}) {
  for (const [name, re] of PATTERNS) {
    for (const m of text.matchAll(re)) {
      if (name.startsWith("JWT") && jwtIsPublic(m[0])) continue;
      found.push(`${name} — ${where}`);
    }
  }
  for (const [name, value] of secrets) if (!(repo && PUBLIC_IN_REPO.has(name)) && text.includes(value)) found.push(`значение ${name} — ${where}`);
}

const git = (args, max = 1024 * 1024 * 1024) => execFileSync("git", args, { cwd: ROOT, maxBuffer: max, encoding: "utf8" });
const report = {};

// 1. Файлы репозитория
{
  const found = [];
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
  for (const f of files) {
    if (/\.(jpe?g|png|gif|webp|ico|woff2?|onnx|wasm|bin)$/i.test(f)) continue;
    const p = join(ROOT, f);
    if (!existsSync(p) || statSync(p).size > 5 * 1024 * 1024) continue;
    scanText(readFileSync(p, "utf8"), f, found, { repo: true });
  }
  report["файлы репозитория"] = { checked: files.length, found };
}

// 2. История git: все ветки и теги, все изменения
{
  const found = [];
  const log = git(["log", "--all", "-p", "--no-color", "--no-ext-diff", "--format=@@commit %h"]);
  let commit = "";
  const lines = log.split("\n");
  for (const line of lines) {
    if (line.startsWith("@@commit ")) commit = line.slice(9);
    else if (line.startsWith("+") || line.startsWith("-")) scanText(line, `коммит ${commit}`, found, { repo: true });
  }
  const refs = git(["for-each-ref", "--format=%(refname:short)"]).split("\n").filter(Boolean).length;
  report["история git"] = { checked: `${refs} веток и тегов, ${lines.length} строк`, found: [...new Set(found)] };
}

// 3. Собранный фронтенд
{
  const found = [];
  let n = 0;
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|css|html|json|map|txt)$/.test(e.name)) {
        n += 1;
        scanText(readFileSync(p, "utf8"), p.slice(ROOT.length), found);
      }
    }
  };
  const dir = join(ROOT, ".next", "static");
  if (existsSync(dir)) walk(dir);
  report[".next/static"] = { checked: existsSync(dir) ? `${n} файлов` : "нет сборки (npm run build)", found };
}

// 4. .gitignore и .env.example
{
  const ignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
  const tracked = git(["ls-files"]).split("\n").filter((f) => /(^|\/)\.env/.test(f) && !f.endsWith(".env.example"));
  const found = [];
  if (!/^\.env\*?/m.test(ignore) && !/\.env\.local/.test(ignore)) found.push(".env* нет в .gitignore");
  for (const f of tracked) found.push(`файл окружения в git: ${f}`);
  const example = join(ROOT, ".env.example");
  if (existsSync(example)) for (const line of readFileSync(example, "utf8").split("\n")) if (/^[A-Z0-9_]+=\S{8,}/.test(line)) found.push(`.env.example: значение у ${line.split("=")[0]}`);
  report[".gitignore и .env.example"] = { checked: "есть", found };
}

let total = 0;
for (const [area, r] of Object.entries(report)) {
  total += r.found.length;
  console.log(`${r.found.length ? "✖" : "✔"} ${area}: проверено ${r.checked}; находок: ${r.found.length}`);
  for (const f of r.found.slice(0, 20)) console.log("   - " + f);
}
console.log(`Значений секретов из окружения для сравнения: ${secrets.length} (сами значения не печатаются)`);

// 5. npm audit (нужна сеть; без сети — только предупреждение)
try {
  const out = execFileSync("npm", ["audit", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 120_000, stdio: ["ignore", "pipe", "ignore"] });
  const v = JSON.parse(out).metadata?.vulnerabilities || {};
  console.log(`npm audit: critical ${v.critical || 0}, high ${v.high || 0}, moderate ${v.moderate || 0}, low ${v.low || 0}`);
} catch (e) {
  const out = e.stdout ? String(e.stdout) : "";
  try {
    const v = JSON.parse(out).metadata?.vulnerabilities || {};
    console.log(`npm audit: critical ${v.critical || 0}, high ${v.high || 0}, moderate ${v.moderate || 0}, low ${v.low || 0}`);
  } catch {
    console.log("npm audit: не удалось получить сводку (нет сети?)");
  }
}

process.exit(total ? 1 : 0);
