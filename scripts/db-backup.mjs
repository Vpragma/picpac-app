// Резервная копия данных: каждая таблица схемы public — в отдельный JSON-файл.
// Схему auth не трогаем. Данные на экран не выводим — только имена таблиц и число строк.
// Копия кладётся в ~/Documents/hackathon/backups/db-<время>/ (папка hackathon — на уровень выше проекта).
// Запуск: npm run db:backup (адрес базы — POSTGRES_URL_NON_POOLING из .env.local).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(root, "..", "backups", `db-${stamp}`);

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("Нет переменной POSTGRES_URL_NON_POOLING. Выполните: npm run env:sync");
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name`;
  mkdirSync(dir, { recursive: true });
  let total = 0;
  for (const { table_name: name } of tables) {
    const rows = await sql`select * from public.${sql(name)}`;
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rows, null, 1));
    total += rows.length;
    console.log(`• ${name}: ${rows.length}`);
  }
  console.log(`Готово: таблиц ${tables.length}, строк ${total}. Папка: ${dir}`);
} catch (e) {
  console.error("Ошибка копирования:", e?.message || e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
