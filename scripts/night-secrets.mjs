// Создаёт недостающие секреты ночных этапов (пуши, cron, мок ERP, аналитика),
// дописывает их в .env.local и добавляет в Vercel (production, preview, development).
// Значения на экран не выводятся и в аргументы команд не попадают — только через stdin.
// Уже существующие ключи не меняет. Запуск: npm run env:night-secrets
import { execFileSync } from "node:child_process";
import { createECDH, randomBytes } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const globalBin = join(homedir(), ".npm-global", "bin", "vercel");
const vercel = existsSync(globalBin) ? globalBin : "vercel";

// Ключи VAPID для Web Push: пара P-256, в формате base64url (как у web-push)
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const vapidPublic = ecdh.getPublicKey().toString("base64url");
const vapidPrivate = ecdh.getPrivateKey().toString("base64url");
const hex32 = () => randomBytes(32).toString("hex");

const wanted = {
  VAPID_PUBLIC_KEY: vapidPublic,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: vapidPublic,
  VAPID_PRIVATE_KEY: vapidPrivate,
  VAPID_SUBJECT: "mailto:support@picpac.by",
  CRON_SECRET: hex32(),
  ERP_SECRET: hex32(),
  ANALYTICS_SALT: hex32(),
  NEXT_PUBLIC_SUPABASE_URL: process.env.SUPABASE_URL,
};

// Пара VAPID должна совпадать: если одна половина уже есть, вторую не создаём
if (process.env.VAPID_PUBLIC_KEY || process.env.VAPID_PRIVATE_KEY) {
  delete wanted.VAPID_PUBLIC_KEY;
  delete wanted.VAPID_PRIVATE_KEY;
  if (!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PUBLIC_KEY) {
    wanted.NEXT_PUBLIC_VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
  } else delete wanted.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
}

let failed = 0;
for (const [name, value] of Object.entries(wanted)) {
  if (process.env[name] || !value) {
    console.log(`• ${name} — уже есть, пропускаю`);
    continue;
  }
  appendFileSync(join(root, ".env.local"), `${name}="${value}"\n`);
  try {
    execFileSync(
      vercel,
      ["env", "add", name, "--environment", "production,preview,development", "--no-sensitive", "--yes"],
      { cwd: root, input: value, stdio: ["pipe", "ignore", "pipe"] },
    );
    console.log(`✓ ${name} — в .env.local и Vercel`);
  } catch (e) {
    failed++;
    console.error(`✗ ${name} — в .env.local записан, в Vercel не добавлен:`, String(e?.stderr || "").split("\n").find((l) => l.trim())?.slice(0, 200));
  }
}
if (failed) process.exitCode = 1;
