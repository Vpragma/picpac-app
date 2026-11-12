// Пункт 23: пометить события статистики тестовых аккаунтов (e2e-…, critic-…) как is_test — они не попадут
// в «Только реальные». Аккаунты e2e удаляются после тестов, поэтому их id берём и из журнала действий.
// Запуск: node --env-file-if-exists=.env.local scripts/mark-test-analytics.mjs. Печатает только числа.
import { createHash } from "node:crypto";
import postgres from "postgres";

const url = process.env.POSTGRES_URL_NON_POOLING;
const salt = process.env.ANALYTICS_SALT;
if (!url || !salt) {
  console.error("Нет POSTGRES_URL_NON_POOLING или ANALYTICS_SALT");
  process.exit(1);
}
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
try {
  const rows = await sql`
    select distinct user_id::text as id from public.audit_log
     where user_id is not null and (details ->> 'email' ilike 'e2e-%' or details ->> 'email' ilike 'critic-%')
    union
    select id::text from auth.users where email ilike 'e2e-%' or email ilike 'critic-%'`;
  const hashes = rows.map((r) => createHash("sha256").update(salt + ":" + r.id).digest("hex"));
  let marked = 0;
  for (let i = 0; i < hashes.length; i += 500) {
    const part = hashes.slice(i, i + 500);
    const res = await sql`update public.analytics_events set is_test = true where not is_test and user_hash = any(${part})`;
    marked += res.count;
  }
  console.log(`Тестовых аккаунтов: ${rows.length}, помечено событий: ${marked}`);
} catch (e) {
  console.error("Ошибка:", e?.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
