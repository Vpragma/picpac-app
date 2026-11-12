// N10 · Очистка тестового мусора в общей базе. Повторяемая: её запускают после каждой ночи тестов.
//   npm run cleanup:test -- --dry-run          только посчитать (ничего не меняет)
//   npm run cleanup:test                       резервная копия (npm run db:backup) → удаление → итог
//   --min-age=45        записи моложе N минут не трогаем (параллельно идут тесты других дорожек)
//   --files-min-age=60  файлы-сироты в хранилище — только старше N минут
// Что считается мусором:
//   • тестовые аккаунты: почта e2e-…, critic-…, night2-… или любой адрес на зарезервированных доменах (example.com/.org/.net,
//     *.test, *.example, *.invalid) — кроме демо-аккаунтов client@, moderator@, admin@example.com и синтетики synthetic-…;
//     без действий в журнале за последние --min-age минут. С ними — заказы (каскадом позиции, история, обращения,
//     уведомления, модерация), запросы на удаление данных, файлы, проекты, фото, корзины, подписки.
//   • «ничьи» заказы (аккаунт уже удалён), если журнал показывает, что их оформил тестовый аккаунт;
//   • «ничьи» запросы на удаление фото от удалённых тестовых аккаунтов (по журналу ±10 с);
//   • уведомления сотрудникам по автотестам (is_test) и по шагам симулятора ERP (старая лента до миграции 0018);
//   • файлы-сироты в хранилище photos: ни одна запись (фото проекта, печать, модерация, снимок заказа) на них не ссылается.
// Никогда не трогаем: журнал действий (только чтение; проверяем, что удаление аккаунта его не каскадит), синтетику
// (synthetic-001…200, их заказы и события), демо-аккаунты и их данные, пуш-подписки и корзину client@example.com.
// Печатает только числа и служебные id; почту — только тестовых аккаунтов. Секреты не печатает.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const num = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  const v = a ? Number(a.split("=")[1]) : def;
  return Number.isFinite(v) && v >= 0 ? v : def;
};
const MIN_AGE = num("min-age", 45);
const FILES_MIN_AGE = num("files-min-age", 60);

const DEMO = ["client@example.com", "moderator@example.com", "admin@example.com"];
// Тестовый аккаунт (SQL): префиксы автотестов и агентов или зарезервированный домен, но не демо и не синтетика
const TEST_USER_SQL = `(u.email ~* '^(e2e|critic|night2)-' or split_part(lower(u.email), '@', 2) in ('example.com','example.org','example.net')
   or lower(u.email) ~ '\\.(test|example|invalid|localhost)$')
  and lower(u.email) <> all (array['${DEMO.join("','")}'])
  and u.email !~* '^synthetic-'
  and not exists (select 1 from public.profiles p where p.id = u.id and p.is_synthetic)`;
const TEST_EMAIL_SQL = (col) => `(${col} ~* '^(e2e|critic|night2)-' or (split_part(lower(${col}), '@', 2) in ('example.com','example.org','example.net')
   and lower(${col}) <> all (array['${DEMO.join("','")}']) and ${col} !~* '^synthetic-'))`;

const url = process.env.POSTGRES_URL_NON_POOLING;
const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !sbUrl || !sbKey) {
  console.error("Нет POSTGRES_URL_NON_POOLING, SUPABASE_URL или секретного ключа Supabase. Выполните: npm run env:sync");
  process.exit(1);
}
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
const sb = createClient(sbUrl, sbKey, { auth: { persistSession: false, autoRefreshToken: false } });

const rows = []; // [что, сколько, пример id]
const add = (what, list, pick = (x) => x.id) => rows.push([what, list.length, list.length ? String(pick(list[0])) : "—"]);
const table = (title, data) => {
  console.log(`\n${title}\n\n| Что | Сколько | Пример id |\n|---|---:|---|`);
  for (const [w, n, ex] of data) console.log(`| ${w} | ${n} | ${ex} |`);
};

async function protectedCounts() {
  const [r] = await sql`
    select
      (select count(*)::int from auth.users where email ~* '^synthetic-') as synthetic_users,
      (select count(*)::int from public.orders where is_synthetic) as synthetic_orders,
      (select count(*)::int from public.analytics_events where is_synthetic) as synthetic_events,
      (select count(*)::int from auth.users where lower(email) = any (${DEMO})) as demo_accounts,
      (select count(*)::int from public.push_subscriptions s join auth.users u on u.id = s.user_id where lower(u.email) = 'client@example.com') as client_push,
      (select count(*)::int from public.cart_items c join auth.users u on u.id = c.user_id where lower(u.email) = 'client@example.com') as client_cart,
      (select count(*)::int from public.audit_log) as audit_log`;
  return r;
}

try {
  const hasIsTest = (await sql`select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff_notifications' and column_name = 'is_test'`).length > 0;

  // Журнал действий не должен пострадать: ни одного внешнего ключа из audit_log (каскад удалил или обнулил бы строки)
  const auditFks = await sql`select conname from pg_constraint where contype = 'f' and conrelid = 'public.audit_log'::regclass`;
  const keepAccounts = auditFks.length > 0;

  // 1. Тестовые аккаунты старше MIN_AGE и без действий в журнале за MIN_AGE минут
  const users = await sql.unsafe(
    `select u.id, u.email, u.created_at from auth.users u
      where ${TEST_USER_SQL}
        and u.created_at < now() - make_interval(mins => $1)
        and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(mins => $1)
        and not exists (select 1 from public.audit_log a where a.user_id = u.id and a.at > now() - make_interval(mins => $1))
      order by u.created_at`,
    [MIN_AGE],
  );
  const busy = await sql.unsafe(
    `select count(*)::int n from auth.users u where ${TEST_USER_SQL}
       and not (u.created_at < now() - make_interval(mins => $1)
                and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(mins => $1)
                and not exists (select 1 from public.audit_log a where a.user_id = u.id and a.at > now() - make_interval(mins => $1)))`,
    [MIN_AGE],
  );
  const ids = users.map((u) => u.id);
  const of = async (q) => (ids.length ? await q : []);
  const uOrders = await of(sql`select id, number from public.orders where user_id = any (${ids}::uuid[]) and not is_synthetic`);
  const uInteractions = await of(sql`select id from public.interactions where user_id = any (${ids}::uuid[]) or order_id = any (${uOrders.map((o) => o.id)}::uuid[])`);
  const uProjects = await of(sql`select id from public.projects where user_id = any (${ids}::uuid[])`);
  const uPhotos = await of(sql`select id from public.project_photos where user_id = any (${ids}::uuid[])`);
  const uCart = await of(sql`select id from public.cart_items where user_id = any (${ids}::uuid[])`);
  const uRequests = await of(sql`select id from public.data_requests where user_id = any (${ids}::uuid[])`);
  const uPush = await of(sql`select id from public.push_subscriptions where user_id = any (${ids}::uuid[])`);
  const uNotes = await of(sql`select id from public.notifications where user_id = any (${ids}::uuid[])`);
  const uFiles = await of(sql`select name as id from storage.objects where bucket_id = 'photos' and split_part(name, '/', 1) = any (${ids.map(String)})`);

  // 2. «Ничьи» заказы тестовых аккаунтов (аккаунт удалён, заказ остался из-за ON DELETE SET NULL)
  const orphanOrders = await sql.unsafe(
    `select o.id, o.number from public.orders o
      where o.user_id is null and not o.is_synthetic and o.created_at < now() - make_interval(mins => $1)
        and (o.idempotency_key ~* '^(e2e|critic|night2)-'
             or exists (select 1 from public.audit_log a where a.action = 'order.create' and a.result = 'success'
                         and a.object_id = o.number and ${TEST_EMAIL_SQL("(a.details ->> 'email')")}))`,
    [MIN_AGE],
  );
  const unknownOrphans = await sql.unsafe(
    `select count(*)::int n from public.orders o where o.user_id is null and not o.is_synthetic
       and not (o.id = any ($1::uuid[]))`,
    [orphanOrders.map((o) => o.id)],
  );
  const oInteractions = orphanOrders.length ? await sql`select id from public.interactions where order_id = any (${orphanOrders.map((o) => o.id)}::uuid[])` : [];

  // 3. «Ничьи» запросы на удаление фото от удалённых тестовых аккаунтов
  const orphanRequests = await sql.unsafe(
    `select d.id from public.data_requests d
      where d.user_id is null and d.created_at < now() - make_interval(mins => $1)
        and exists (select 1 from public.audit_log a where a.action = 'account.delete_photos'
                     and a.at between d.created_at - interval '10 seconds' and d.created_at + interval '10 seconds'
                     and ${TEST_EMAIL_SQL("(a.details ->> 'email')")})`,
    [MIN_AGE],
  );

  // 4. Уведомления сотрудникам: автотесты (is_test) и шаги симулятора ERP по одному (лента до 0018)
  const cascadeOrders = [...uOrders, ...orphanOrders].map((o) => o.id);
  const staffTest = hasIsTest
    ? await sql.unsafe(
        `select id from public.staff_notifications where is_test and created_at < now() - make_interval(mins => $1)
           and (order_id is null or not (order_id = any ($2::uuid[])))`,
        [MIN_AGE, cascadeOrders],
      )
    : [];
  const staffSim = await sql.unsafe(
    `select n.id from public.staff_notifications n join public.order_status_history h on n.dedupe_key = 'hist:' || h.id
      where h.event_id like 'sim:%' and n.created_at < now() - make_interval(mins => $1)
        and not (n.order_id = any ($2::uuid[]))${hasIsTest ? " and not n.is_test" : ""}`,
    [MIN_AGE, cascadeOrders],
  );
  const staffCascade = cascadeOrders.length ? await sql`select id from public.staff_notifications where order_id = any (${cascadeOrders}::uuid[])` : [];
  const staffNotesOfStaff = await sql`
    select n.id from public.notifications n join auth.users u on u.id = n.user_id where lower(u.email) in ('admin@example.com', 'moderator@example.com')`;

  // 5. Файлы-сироты: ни одна запись на них не ссылается (фото проектов, печатные версии, модерация, снимки заказов)
  const orphanFiles = await sql`
    select o.name as id, coalesce((o.metadata ->> 'size')::bigint, 0) as bytes from storage.objects o
     where o.bucket_id = 'photos' and o.created_at < now() - make_interval(mins => ${FILES_MIN_AGE})
       and not (split_part(o.name, '/', 1) = any (${ids.map(String)}))
       and not exists (select 1 from public.project_photos p where p.storage_path = o.name or p.print_path = o.name)
       and not exists (select 1 from public.moderation_reviews r where r.photo_path = o.name)
       and not exists (select 1 from public.order_items i where strpos(i.snapshot::text, o.name) > 0)`;

  const before = await protectedCounts();
  add("Тестовые аккаунты (старше " + MIN_AGE + " мин, без действий за это время)" + (keepAccounts ? " — НЕ удаляем: у журнала есть внешний ключ" : ""), users, (u) => `${u.id} (${u.email})`);
  add("· их заказы (каскадом: позиции, история, события ERP, модерация, уведомления)", uOrders, (o) => `${o.id} (${o.number})`);
  add("· их обращения (каскадом: сообщения)", uInteractions);
  add("· их проекты (каскадом: фото, корзина)", uProjects);
  add("· их фото (записи)", uPhotos);
  add("· их позиции корзины", uCart);
  add("· их запросы на удаление данных", uRequests);
  add("· их пуш-подписки", uPush);
  add("· их уведомления (центр клиента)", uNotes);
  add("· их файлы в хранилище", uFiles);
  add("«Ничьи» заказы тестовых аккаунтов (аккаунт уже удалён)", orphanOrders, (o) => `${o.id} (${o.number})`);
  add("· обращения этих заказов", oInteractions);
  add("«Ничьи» запросы на удаление фото от удалённых тестовых аккаунтов", orphanRequests);
  add("Уведомления сотрудникам по заказам автотестов и удалённых тестовых аккаунтов (каскадом с заказами)", staffCascade);
  add("Уведомления сотрудникам по автотестам (is_test), остальные", staffTest);
  add("Уведомления сотрудникам по шагам симулятора ERP (по одному на шаг, до сводки 0018)", staffSim);
  add("Файлы-сироты в хранилище (старше " + FILES_MIN_AGE + " мин, ни одна запись не ссылается)", orphanFiles);
  table(DRY ? "Только посчитать (--dry-run): будет удалено" : "План удаления", rows);
  console.log(`\nНе трогаем: тестовых аккаунтов моложе ${MIN_AGE} мин или с действиями за это время — ${busy[0].n}; «ничьих» заказов без признаков теста — ${unknownOrphans[0].n};`);
  console.log(`уведомления центра клиента у admin@ и moderator@ — ${staffNotesOfStaff.length} (это данные демо-аккаунтов, только считаем).`);
  console.log(`Защищено: синтетика — ${before.synthetic_users} аккаунтов, ${before.synthetic_orders} заказов, ${before.synthetic_events} событий; демо-аккаунтов ${before.demo_accounts}; пуш-подписок client@ ${before.client_push}; позиций корзины client@ ${before.client_cart}; журнал — ${before.audit_log} записей.`);
  console.log(`Журнал действий: внешних ключей из audit_log — ${auditFks.length} (${keepAccounts ? "аккаунты не удаляем" : "удаление аккаунтов журнал не меняет"}).`);
  const freeMb = orphanFiles.reduce((a, f) => a + Number(f.bytes), 0) / 1048576;
  if (orphanFiles.length) console.log(`Файлы-сироты: ${freeMb.toFixed(1)} МБ.`);

  if (DRY) {
    console.log("\nЭто был подсчёт. Удалить: npm run cleanup:test");
  } else {
    // Резервная копия перед удалением (данные схемы public) + список того, что удаляем (только служебные id и тестовые адреса)
    const backup = spawnSync(process.execPath, [join(root, "scripts", "db-backup.mjs")], { env: process.env, encoding: "utf8" });
    const last = (backup.stdout || "").trim().split("\n").pop();
    if (backup.status !== 0) throw new Error("резервная копия не получилась — удаление отменено. " + (backup.stderr || "").slice(0, 300));
    console.log("\nРезервная копия: " + last);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = join(root, "..", "backups");
    mkdirSync(dir, { recursive: true });
    const manifest = join(dir, `cleanup-${stamp}.json`);
    writeFileSync(
      manifest,
      JSON.stringify({ at: new Date().toISOString(), minAge: MIN_AGE, users, orders: [...uOrders, ...orphanOrders], requests: [...uRequests, ...orphanRequests], files: [...uFiles, ...orphanFiles].map((f) => f.id) }, null, 1),
    );
    console.log("Список удаляемого: " + manifest);

    const done = [];
    const del = async (what, q) => {
      const r = await q;
      done.push([what, r.count ?? r.length ?? 0, "—"]);
    };
    // Заказы — первыми: у них ON DELETE SET NULL на аккаунт, иначе останутся «ничьими»
    await del("Заказы тестовых аккаунтов и «ничьи» заказы тестов", cascadeOrders.length ? sql`delete from public.orders where id = any (${cascadeOrders}::uuid[]) and not is_synthetic` : []);
    await del("Обращения тестовых аккаунтов (не по заказам)", ids.length ? sql`delete from public.interactions where user_id = any (${ids}::uuid[])` : []);
    const reqIds = [...uRequests, ...orphanRequests].map((x) => x.id);
    await del("Запросы на удаление данных", reqIds.length ? sql`delete from public.data_requests where id = any (${reqIds}::uuid[])` : []);
    const noteIds = [...staffTest, ...staffSim].map((x) => Number(x.id));
    await del("Уведомления сотрудникам (автотесты и шаги симулятора)", noteIds.length ? sql`delete from public.staff_notifications where id = any (${noteIds}::bigint[])` : []);

    // Файлы — через Storage API (прямое удаление из storage.objects база запрещает)
    const paths = [...uFiles, ...orphanFiles].map((f) => f.id);
    let removed = 0;
    for (let i = 0; i < paths.length; i += 100) {
      const { data, error } = await sb.storage.from("photos").remove(paths.slice(i, i + 100));
      if (error) console.error("Хранилище: не удалось удалить часть файлов:", error.message);
      removed += data?.length || 0;
    }
    done.push(["Файлы в хранилище", removed, "—"]);

    // Аккаунты — через Admin API: каскадом профили, роли, проекты, фото, корзины, подписки, уведомления, сессии
    let accounts = 0;
    if (!keepAccounts) {
      for (const u of users) {
        const { error } = await sb.auth.admin.deleteUser(u.id);
        if (error) console.error(`Аккаунт ${u.id}: ${error.message}`);
        else accounts++;
      }
    } else {
      if (ids.length) await del("Проекты тестовых аккаунтов (аккаунты оставлены)", sql`delete from public.projects where user_id = any (${ids}::uuid[])`);
    }
    done.push(["Тестовые аккаунты (каскадом: профили, роли, проекты, фото, корзины, подписки, уведомления)", accounts, "—"]);

    // События статистики тестовых аккаунтов — пометить is_test (не удалять): «Только реальные» их не покажет
    const mark = spawnSync(process.execPath, [join(root, "scripts", "mark-test-analytics.mjs")], { env: process.env, encoding: "utf8" });
    if (mark.status === 0) console.log("Статистика: " + (mark.stdout || "").trim().split("\n").pop());

    const after = await protectedCounts();
    table("Удалено", done);
    const same = ["synthetic_users", "synthetic_orders", "synthetic_events", "demo_accounts", "client_push", "client_cart"].every((k) => after[k] === before[k]);
    console.log(`\nПроверка «не тронуто»: ${same ? "да" : "НЕТ — сравните числа"} (синтетика ${after.synthetic_users}/${after.synthetic_orders}/${after.synthetic_events}, демо ${after.demo_accounts}, пуш client@ ${after.client_push}, корзина client@ ${after.client_cart}).`);
    console.log(`Журнал действий: было ${before.audit_log}, стало ${after.audit_log} (${after.audit_log >= before.audit_log ? "ни одна запись не удалена" : "ВНИМАНИЕ: записей стало меньше"}).`);
    if (!same || after.audit_log < before.audit_log) process.exitCode = 2;
  }
} catch (e) {
  console.error("Ошибка очистки:", e?.message || e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
