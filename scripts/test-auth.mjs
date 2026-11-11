// Проверка входа, ролей и защиты админки (ОТ-02, ОТ-04).
// Запуск: npm run test:auth                     — против локального сервера http://localhost:3000
//         npm run test:auth -- https://адрес-превью  — против превью на Vercel
// Пароль тестовых аккаунтов берётся из SEED_PASSWORD в .env.local и никуда не печатается.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const PASSWORD = process.env.SEED_PASSWORD;
const AUDIT = "/api/v1/admin/audit";
// Если превью закрыто защитой Vercel — можно передать ключ обхода для автотестов
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

let failed = 0;
const startedAt = new Date();

function report(ok, title, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${title}${detail ? ` — ${detail}` : ""}`);
}

// Браузер в миниатюре: хранит cookies между запросами
class Client {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
  }
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async req(path, { method = "GET", body, headers = {} } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = this.cookieHeader();
    if (body) h["content-type"] = "application/json";
    if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
    const res = await fetch(BASE + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone = !value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a) || (/^\s*expires=/i.test(a) && new Date(a.split("=")[1]) < new Date()));
      if (gone) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }
  async login(email, password) {
    return this.req("/api/v1/auth/login", { method: "POST", body: { email, password } });
  }
}

async function main() {
  console.log(`Проверяем ${BASE}\n`);
  if (!PASSWORD) {
    console.error("Нет SEED_PASSWORD в .env.local — без него не войти под тестовыми аккаунтами.");
    process.exit(1);
  }

  // 1) Гость
  const guest = new Client("гость");
  const g = await guest.req(AUDIT);
  report(g.status === 401, `1) гость → GET ${AUDIT}`, `код ${g.status}, ожидали 401`);

  // 2) Клиент
  const client = new Client("клиент");
  const cl = await client.login("client@example.com", PASSWORD);
  if (cl.status !== 200) {
    report(false, "вход client@example.com", `код ${cl.status}: ${cl.json?.error?.message || ""}`);
  } else {
    const c = await client.req(AUDIT);
    report(c.status === 403, `2) клиент → GET ${AUDIT}`, `код ${c.status}, ожидали 403`);

    // 3) Клиент подменяет cookie роли на admin
    const me = await client.req("/api/v1/me");
    const userId = me.json?.user?.id;
    client.jar.set("pp_role", `admin.${userId}`);
    const f1 = await client.req(AUDIT);
    client.jar.set("pp_role", "admin");
    const f2 = await client.req(AUDIT);
    report(f1.status === 403 && f2.status === 403, `3) клиент с подменённой cookie роли admin → GET ${AUDIT}`, `коды ${f1.status} и ${f2.status}, ожидали 403`);
  }

  // 4) Админ: вход → выбор роли admin → журнал
  const admin = new Client("админ");
  const al = await admin.login("admin@example.com", PASSWORD);
  const needChoice = al.json?.redirect?.startsWith("/login/role");
  const ar = await admin.req("/api/v1/auth/role", { method: "POST", body: { role: "admin" } });
  const a = await admin.req(AUDIT);
  report(
    al.status === 200 && needChoice && ar.status === 200 && a.status === 200 && Array.isArray(a.json?.items),
    `4) админ с ролью admin → GET ${AUDIT}`,
    `вход ${al.status}${needChoice ? " → экран выбора роли" : ""}, выбор роли ${ar.status}, журнал ${a.status}, ожидали 200`
  );

  // 5) Неверный пароль: понятная ошибка и запись в журнале
  const bad = new Client("взломщик");
  const b = await bad.login("client@example.com", "неверный-пароль-123");
  const msgOk = b.status === 401 && b.json?.error?.message === "Неверная почта или пароль.";
  const log = await admin.req(`${AUDIT}?limit=50`);
  const entry = (log.json?.items || []).find(
    (i) => i.action === "auth.login" && i.result === "error" && i.details?.email === "client@example.com" && new Date(i.at) >= new Date(startedAt.getTime() - 5000)
  );
  report(msgOk && !!entry, "5) неверный пароль", `код ${b.status}, текст «${b.json?.error?.message || "—"}», запись в журнале: ${entry ? "есть" : "НЕТ"}`);

  // 6) Секреты не попали в код для браузера
  scanStatic();

  // Дополнительные проверки
  console.log("\nДополнительно:");
  const mod = new Client("модератор");
  const ml = await mod.login("moderator@example.com", PASSWORD);
  const m = await mod.req(AUDIT);
  const mp = await mod.req("/admin");
  report(ml.status === 200 && m.status === 403 && mp.status === 200, "модератор: журнал закрыт (403), раздел заказов открыт (200)", `вход ${ml.status}, журнал ${m.status}, /admin ${mp.status}`);

  const asClient = await admin.req("/api/v1/auth/role", { method: "POST", body: { role: "client" } });
  const ac = await admin.req(AUDIT);
  report(asClient.status === 200 && ac.status === 403, "админ, переключившийся на роль клиента → журнал", `код ${ac.status}, ожидали 403`);
  const steal = await client.req("/api/v1/auth/role", { method: "POST", body: { role: "admin" } });
  report(steal.status === 403, "клиент просит роль admin через API", `код ${steal.status}, ожидали 403`);

  const gp = await guest.req("/admin");
  report(gp.status === 401 && gp.text.includes("Нужно войти"), "гость → страница /admin", `код ${gp.status}, страница «Нужно войти»: ${gp.text.includes("Нужно войти") ? "да" : "нет"}`);
  const cp = await client.req("/admin");
  report(cp.status === 403 && cp.text.includes("Нет доступа"), "клиент → страница /admin", `код ${cp.status}, страница «Нет доступа»: ${cp.text.includes("Нет доступа") ? "да" : "нет"}`);

  const csrf = await guest.req("/api/v1/auth/login", { method: "POST", body: { email: "client@example.com", password: "x" }, headers: { origin: "https://evil.example" } });
  report(csrf.status === 403, "вход с чужого сайта (CSRF)", `код ${csrf.status}, ожидали 403`);

  const denied = (log.json?.items || []).length ? await admin.req("/api/v1/auth/role", { method: "POST", body: { role: "admin" } }).then(() => admin.req(`${AUDIT}?limit=50`)) : null;
  const forged = (denied?.json?.items || []).find((i) => i.action === "access.denied" && i.details?.claimed_role === "admin" && new Date(i.at) >= new Date(startedAt.getTime() - 5000));
  report(!!forged, "подмена cookie записана в журнал как «отказ в доступе»", forged ? "есть" : "НЕТ");

  const out = await client.req("/api/v1/auth/logout", { method: "POST" });
  const after = await client.req("/api/v1/me");
  report(out.status === 200 && after.json?.authenticated === false && !client.jar.has("pp_role"), "выход очищает сессию и роль", `me.authenticated=${after.json?.authenticated}`);

  console.log(failed ? `\nНе прошло проверок: ${failed}` : "\nВсе проверки пройдены.");
  process.exitCode = failed ? 1 : 0;
}

function scanStatic() {
  const dir = join(root, ".next", "static");
  if (!existsSync(dir)) {
    report(false, "6) секреты в коде для браузера", "нет папки .next/static — сначала выполните npm run build");
    return;
  }
  const secrets = {
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,
    SEED_PASSWORD: process.env.SEED_PASSWORD,
  };
  const files = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  const found = [];
  for (const f of files) {
    const text = readFileSync(f, "latin1");
    for (const [name, value] of Object.entries(secrets)) {
      if (value && value.length >= 8 && text.includes(value)) found.push(name);
    }
    if (text.includes("sb_secret_")) found.push("ключ вида sb_secret_");
  }
  const missing = Object.entries(secrets).filter(([, v]) => !v).map(([k]) => k);
  report(
    !found.length,
    "6) секретный ключ и тестовый пароль не попали в код для браузера",
    `проверено файлов: ${files.length}; найдено: ${found.length ? [...new Set(found)].join(", ") : "ничего"}${missing.length ? `; не заданы для проверки: ${missing.join(", ")}` : ""}`
  );
}

main().catch((e) => {
  console.error("Тест упал:", e.message);
  process.exit(1);
});
