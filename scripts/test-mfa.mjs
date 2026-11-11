// Проверка двухфакторного входа для сотрудников (шаг 9).
// Нужен сервер с REQUIRE_STAFF_MFA=true, например: REQUIRE_STAFF_MFA=true npm start -- -p 3001
// Запуск: npm run test:mfa -- http://localhost:3001
// Тест создаёт временного администратора (общие тестовые аккаунты не трогает),
// сам считает 6-значный код, как приложение-аутентификатор, и в конце удаляет пользователя.
import { createClient } from "@supabase/supabase-js";
import { createHmac, randomBytes } from "node:crypto";

const BASE = (process.argv[2] || process.env.TEST_BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Нет SUPABASE_URL или SUPABASE_SECRET_KEY в .env.local");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

let failed = 0;
function report(ok, title, detail) {
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${title}${detail ? ` — ${detail}` : ""}`);
}

// Код TOTP (RFC 6238): то же, что показывает приложение-аутентификатор
function base32(s) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of s.replace(/=+$/, "").toUpperCase()) bits += abc.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

class Client {
  jar = new Map();
  async req(path, { method = "GET", body } = {}) {
    const headers = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body) headers["content-type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, headers: res.headers };
  }
}

const email = `mfa-test-${randomBytes(4).toString("hex")}@example.com`;
const password = randomBytes(18).toString("base64url");
let userId = null;

try {
  console.log(`Проверяем двухфакторный вход на ${BASE} (временный аккаунт ${email})\n`);
  // Открытый адрес должен отвечать 200 — иначе сайт не запущен или закрыт защитой Vercel
  const open = await new Client().req("/api/v1/catalog");
  if (open.status !== 200) throw new Error(`открытый адрес /api/v1/catalog ответил кодом ${open.status} — сайт не запущен или закрыт защитой Vercel`);
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: "Временный админ для теста 2FA" } });
  if (error) throw new Error("не удалось создать временного пользователя: " + error.message);
  userId = data.user.id;
  await admin.from("user_roles").delete().eq("user_id", userId);
  const { error: roleError } = await admin.from("user_roles").insert({ user_id: userId, role: "admin" });
  if (roleError) throw new Error("не удалось выдать роль: " + roleError.message);

  const c = new Client();
  const login = await c.req("/api/v1/auth/login", { method: "POST", body: { email, password } });
  const toMfa = login.json?.redirect?.startsWith("/login/mfa");
  if (!toMfa) {
    report(false, "после входа админа ведём на ввод кода", `redirect=${login.json?.redirect}. Похоже, на сервере не включён REQUIRE_STAFF_MFA=true`);
  } else {
    report(true, "после входа с ролью админа — экран кода 2FA", login.json.redirect);

    const before = await c.req("/api/v1/admin/audit");
    report(before.status === 403 && before.json?.error?.code === "mfa_required", "без кода журнал закрыт", `код ${before.status} (${before.json?.error?.code})`);

    const page = await c.req("/admin");
    report(page.status === 307 && (page.headers.get("location") || "").includes("/login/mfa"), "страница /admin без кода отправляет на ввод кода", `код ${page.status}`);

    const enroll = await c.req("/api/v1/auth/mfa/enroll", { method: "POST", body: {} });
    const qrOk = enroll.status === 200 && enroll.json?.qr?.startsWith("data:image/svg+xml;base64,") && !!enroll.json?.secret;
    report(qrOk, "подключение: QR-код и ключ выданы", `код ${enroll.status}`);

    const wrong = await c.req("/api/v1/auth/mfa/verify", { method: "POST", body: { code: "000000", role: "admin", factorId: enroll.json?.factorId } });
    report(wrong.status === 400, "неверный код отклонён", `код ${wrong.status}: ${wrong.json?.error?.message || ""}`);

    const good = await c.req("/api/v1/auth/mfa/verify", { method: "POST", body: { code: totp(enroll.json.secret), role: "admin", factorId: enroll.json.factorId } });
    report(good.status === 200, "верный код принят", `код ${good.status}, дальше ${good.json?.redirect}`);

    const after = await c.req("/api/v1/admin/audit");
    report(after.status === 200, "после кода журнал открыт", `код ${after.status}`);

    const out = await c.req("/api/v1/auth/logout", { method: "POST" });
    const again = await c.req("/api/v1/auth/login", { method: "POST", body: { email, password } });
    const locked = await c.req("/api/v1/admin/audit");
    report(out.status === 200 && again.json?.redirect?.startsWith("/login/mfa") && locked.status === 403, "после нового входа код спрашивается снова", `журнал без кода: ${locked.status}`);

    const log = await c.req("/api/v1/auth/mfa/verify", { method: "POST", body: { code: totp(enroll.json.secret), role: "admin" } });
    const reopened = await c.req("/api/v1/admin/audit");
    const entries = (reopened.json?.items || []).filter((i) => i.details?.email === email && i.action.startsWith("auth.mfa"));
    report(
      log.status === 200 && reopened.status === 200 && entries.some((i) => i.result === "error") && entries.some((i) => i.result === "success"),
      "код на втором входе принят, попытки записаны в журнал",
      `проверка ${log.status}, записей 2FA: ${entries.length}`
    );
  }
} catch (e) {
  report(false, "тест прерван", e.message);
} finally {
  if (userId) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    console.log(error ? `Не удалось удалить временного пользователя: ${error.message}` : "Временный пользователь удалён.");
  }
  console.log(failed ? `\nНе прошло проверок: ${failed}` : "\nВсе проверки 2FA пройдены.");
  process.exitCode = failed ? 1 : 0;
}
