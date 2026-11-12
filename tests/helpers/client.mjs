// Помощники API-тестов: «браузер в миниатюре» с cookies, тестовые пользователи e2e-…@example.com.
// Пароли тестовых пользователей случайные и нигде не печатаются. После тестов пользователи удаляются.
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

export const BASE = (process.env.BASE_URL || process.env.TEST_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;

export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Нет SUPABASE_URL или секретного ключа в .env.local (npm run env:sync)");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseAnon() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  return createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export class Client {
  constructor(name) {
    this.name = name;
    this.jar = new Map();
  }
  async req(path, { method = "GET", body, headers = {}, raw } = {}) {
    const h = { ...headers };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined && !raw) h["content-type"] = "application/json";
    if (BYPASS) h["x-vercel-protection-bypass"] = BYPASS;
    const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined), redirect: "manual" });
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const eq = pair.indexOf("=");
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const gone = !value || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
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
}

// Новый тестовый пользователь с нужными ролями. Возвращает { id, email, password, client }
export async function createTestUser(admin, roles = ["client"], label = "user") {
  const email = `e2e-${label}-${randomUUID().slice(0, 8)}@example.com`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `E2E ${label}` } });
  if (error) throw new Error("Не создать тестового пользователя: " + error.message);
  const id = data.user.id;
  if (!roles.includes("client")) await admin.from("user_roles").delete().eq("user_id", id).eq("role", "client");
  for (const role of roles.filter((r) => r !== "client")) await admin.from("user_roles").upsert({ user_id: id, role });
  const client = new Client(label);
  const login = await client.req("/api/v1/auth/login", { method: "POST", body: { email, password } });
  if (login.status !== 200) throw new Error(`Вход ${label}: код ${login.status}`);
  return { id, email, password, client };
}

// Удалить тестового пользователя и его файлы
export async function deleteTestUser(admin, user) {
  if (!user?.id) return;
  // Файлы пользователя, включая печатные версии ({user}/{project}/print/{photo}/{file}) — обходим папки вглубь
  const walk = async (prefix, depth) => {
    const { data: items } = await admin.storage.from("photos").list(prefix, { limit: 1000 });
    const paths = [];
    for (const x of items || []) {
      if (x.id) paths.push(`${prefix}/${x.name}`);
      else if (depth < 4) await walk(`${prefix}/${x.name}`, depth + 1);
    }
    if (paths.length) await admin.storage.from("photos").remove(paths);
  };
  await walk(user.id, 1);
  await admin.auth.admin.deleteUser(user.id).catch(() => {});
}
