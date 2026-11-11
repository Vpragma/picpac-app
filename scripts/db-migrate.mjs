// Применяет SQL-миграции из supabase/migrations по порядку имён файлов.
// Повторный запуск безопасен: применённые файлы записаны в private.schema_migrations
// и пропускаются, а каждый файл выполняется целиком в одной транзакции.
// Запуск: npm run db:migrate (адрес базы берётся из POSTGRES_URL_NON_POOLING в .env.local).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "supabase", "migrations");

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("Нет переменной POSTGRES_URL_NON_POOLING. Выполните в папке проекта: vercel env pull .env.local");
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  await sql`create schema if not exists private`;
  await sql`
    create table if not exists private.schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`;

  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let applied = 0;
  for (const name of files) {
    const text = readFileSync(join(dir, name), "utf8");
    const checksum = createHash("sha256").update(text).digest("hex");
    const [done] = await sql`select checksum from private.schema_migrations where name = ${name}`;
    if (done) {
      const note = done.checksum === checksum ? "" : " (ВНИМАНИЕ: файл изменён после применения — изменения вносите новой миграцией)";
      console.log(`• ${name} — уже применена, пропускаю${note}`);
      continue;
    }
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into private.schema_migrations (name, checksum) values (${name}, ${checksum})`;
    });
    applied++;
    console.log(`✓ ${name} — применена`);
  }
  console.log(applied ? `Готово: применено миграций: ${applied}.` : "Готово: новых миграций нет.");
} catch (e) {
  // Пароль базы в сообщении об ошибке не печатаем: выводим только текст ошибки Postgres
  console.error("Ошибка миграции:", e?.message || e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
