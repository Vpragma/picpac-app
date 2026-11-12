// Тестовые аккаунты для проверки (синтетические данные, реальных людей нет).
// Повторный запуск безопасен: аккаунты не дублируются, пароль и роли приводятся к нужным.
// Запуск: npm run seed (берёт SUPABASE_URL, SUPABASE_SECRET_KEY и пароли SEED_PASSWORD_CLIENT,
// SEED_PASSWORD_MODERATOR, SEED_PASSWORD_ADMIN из .env.local; запасной общий — SEED_PASSWORD).
import { createClient } from "@supabase/supabase-js";

const ACCOUNTS = [
  { email: "client@example.com", name: "Тестовый клиент", roles: ["client"], passEnv: "SEED_PASSWORD_CLIENT" },
  { email: "moderator@example.com", name: "Тестовый модератор", roles: ["moderator"], passEnv: "SEED_PASSWORD_MODERATOR" },
  // Две роли — чтобы был виден экран выбора роли
  { email: "admin@example.com", name: "Тестовый администратор", roles: ["client", "admin"], passEnv: "SEED_PASSWORD_ADMIN" },
];

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const passwordFor = (acc) => process.env[acc.passEnv] || process.env.SEED_PASSWORD;
if (!url || !key) {
  console.error("Нет SUPABASE_URL или SUPABASE_SECRET_KEY. Выполните в папке проекта: vercel env pull .env.local");
  process.exit(1);
}
const weak = ACCOUNTS.filter((a) => (passwordFor(a) || "").length < 12);
if (weak.length) {
  console.error(`Нет пароля от 12 символов в .env.local: ${weak.map((a) => a.passEnv).join(", ")} (они же указаны в README).`);
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function findUser(email) {
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Не удалось получить список пользователей: " + error.message);
    const hit = data.users.find((u) => (u.email || "").toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

async function seedAccount(acc) {
  let user = await findUser(acc.email);
  let what;
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: acc.email,
      password: passwordFor(acc),
      email_confirm: true,
      user_metadata: { full_name: acc.name },
      app_metadata: { demo: true }, // тестовый аккаунт: его нельзя удалить из профиля
    });
    if (error) throw new Error(`${acc.email}: не удалось создать — ${error.message}`);
    user = data.user;
    what = "создан";
  } else {
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      password: passwordFor(acc),
      email_confirm: true,
      user_metadata: { ...user.user_metadata, full_name: acc.name },
      app_metadata: { ...user.app_metadata, demo: true },
    });
    if (error) throw new Error(`${acc.email}: не удалось обновить — ${error.message}`);
    what = "уже был, пароль и роли обновлены";
  }

  const { error: profileError } = await admin.from("profiles").upsert({ id: user.id, full_name: acc.name }, { onConflict: "id" });
  if (profileError) throw new Error(`${acc.email}: профиль — ${profileError.message}`);

  // Ровно нужный набор ролей: лишние убираем, недостающие добавляем
  const { error: delError } = await admin.from("user_roles").delete().eq("user_id", user.id).not("role", "in", `(${acc.roles.join(",")})`);
  if (delError) throw new Error(`${acc.email}: роли — ${delError.message}`);
  const { error: roleError } = await admin
    .from("user_roles")
    .upsert(acc.roles.map((role) => ({ user_id: user.id, role })), { onConflict: "user_id,role", ignoreDuplicates: true });
  if (roleError) throw new Error(`${acc.email}: роли — ${roleError.message}`);

  console.log(`✓ ${acc.email} — ${acc.roles.join(" + ")} (${what})`);
}

try {
  for (const acc of ACCOUNTS) await seedAccount(acc);
  console.log("Готово. Пароль тестовых аккаунтов — в README, раздел «Тестовые аккаунты».");
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exitCode = 1;
}
