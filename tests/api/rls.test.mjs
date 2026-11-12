// N6: RLS для КАЖДОЙ таблицы схемы public. Список таблиц берётся из базы: новая таблица проверяется сама.
// Тест падает, если у таблицы выключен RLS, если у неё нет ни одной политики (кроме таблиц только для сервера —
// они перечислены в SERVICE_ONLY с причиной) или если аноним или чужой клиент читает или пишет чужое.
// Как проверяем: прямое подключение к базе, внутри транзакции SET LOCAL ROLE anon / authenticated и request.jwt.claims —
// ровно так PostgREST (Supabase API) выполняет запросы браузера. Каждая транзакция ОТКАТЫВАЕТСЯ: попытки записи
// ничего не меняют, даже если политика сломана. Плюс тот же отказ через настоящий API Supabase с ключом гостя.
// Запуск: npm run test:api (нужны POSTGRES_URL_NON_POOLING и ключи Supabase в .env.local; сервер приложения не нужен).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import postgres from "postgres";
import { supabaseAnon } from "../helpers/client.mjs";

// Таблицы только для сервера: без политик и без прав у anon и authenticated (пишет и читает только сервер).
const SERVICE_ONLY = {
  ai_cloud_budget: "суточный бюджет облачного ИИ — считает сервер",
  ai_cloud_consents: "согласия на облачный ИИ — читает и пишет сервер после проверки входа",
  ai_cloud_usage: "учёт вызовов облачного ИИ — сервер",
  cart_reminders: "отметки отправленных напоминаний о корзине — расписание на сервере",
  promo_redemptions: "применения промокодов (N8): сколько раз и на какую сумму — пишет и читает только сервер",
};
// Таблицы, которые по задумке читают все, даже гость (запись — только сервер): текущий сезон оформления (N2)
const PUBLIC_ALL_READ = new Set(["site_season"]);
// Таблицы, которые по задумке может читать любой вошедший (каталог отдаёт сервер) — плюс общедоступные
const PUBLIC_READ = new Set([...PUBLIC_ALL_READ]);

const sql = postgres(process.env.POSTGRES_URL_NON_POOLING, { max: 1, connect_timeout: 30, onnotice: () => {} });
const DEMO_CLIENT = "client@example.com";
let tables = []; // [{ name, rls, policies, anonGrants, authGrants, col, owner }]
let clientId = null;

class Rollback extends Error {}
// Выполнить fn в транзакции от имени роли (anon | authenticated с sub) и всегда откатить
async function as(role, sub, fn) {
  let out;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role ${role}`);
      const claims = JSON.stringify(sub ? { sub, role } : { role });
      await tx`select set_config('request.jwt.claims', ${claims}, true), set_config('request.jwt.claim.sub', ${sub || ""}, true)`;
      out = await fn(tx);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  return out;
}
// Одна попытка внутри точки сохранения: { ok, rows, count, error }
async function attempt(tx, text) {
  try {
    const r = await tx.savepoint((sp) => sp.unsafe(text));
    return { ok: true, rows: r, count: r.count };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
const q = (name) => `public."${name.replace(/"/g, "")}"`;

before(async () => {
  const rows = await sql`
    select c.relname as name, c.relrowsecurity as rls,
      (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies,
      array_remove(array[
        case when has_table_privilege('anon', c.oid, 'select') then 'select' end, case when has_table_privilege('anon', c.oid, 'insert') then 'insert' end,
        case when has_table_privilege('anon', c.oid, 'update') then 'update' end, case when has_table_privilege('anon', c.oid, 'delete') then 'delete' end], null) as anon_grants,
      array_remove(array[
        case when has_table_privilege('authenticated', c.oid, 'select') then 'select' end, case when has_table_privilege('authenticated', c.oid, 'insert') then 'insert' end,
        case when has_table_privilege('authenticated', c.oid, 'update') then 'update' end, case when has_table_privilege('authenticated', c.oid, 'delete') then 'delete' end], null) as auth_grants,
      (select a.attname from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          and a.attidentity = '' and a.attgenerated = '' order by a.attnum limit 1) as col,
      (select array_agg(a.attname::text) from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
          and a.attname in ('user_id', 'order_id', 'interaction_id', 'project_id')) as links
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`;
  tables = rows;
  const [u] = await sql`select id from auth.users where lower(email) = ${DEMO_CLIENT}`;
  clientId = u?.id || null;
});

after(async () => {
  await sql.end({ timeout: 5 });
});

test("в схеме public есть таблицы, список взят из базы", () => {
  assert.ok(tables.length >= 20, `таблиц: ${tables.length}`);
});

test("RLS включён у каждой таблицы public", () => {
  const off = tables.filter((t) => !t.rls).map((t) => t.name);
  assert.deepEqual(off, [], "RLS выключен: " + off.join(", "));
});

test("у каждой таблицы есть политика — или она в списке «только для сервера» без прав у anon и authenticated", () => {
  const bad = [];
  for (const t of tables) {
    if (SERVICE_ONLY[t.name]) {
      if (t.anon_grants.length || t.auth_grants.length) bad.push(`${t.name}: в SERVICE_ONLY, но есть права (anon: ${t.anon_grants}, authenticated: ${t.auth_grants})`);
    } else if (t.policies === 0) {
      bad.push(`${t.name}: нет ни одной политики RLS — добавьте политику или впишите таблицу в SERVICE_ONLY с причиной`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("гость (anon): ни одной таблицы не читает и ни в одну не пишет — через базу от роли anon", async () => {
  const problems = await as("anon", null, async (tx) => {
    const out = [];
    for (const t of tables) {
      const sel = await attempt(tx, `select count(*)::int as n from ${q(t.name)}`);
      if (sel.ok && sel.rows[0].n > 0 && !PUBLIC_ALL_READ.has(t.name)) out.push(`${t.name}: гость видит строк ${sel.rows[0].n}`);
      const ins = await attempt(tx, `insert into ${q(t.name)} default values`);
      if (ins.ok) out.push(`${t.name}: гость вставил строку`);
      if (t.col) {
        const upd = await attempt(tx, `update ${q(t.name)} set "${t.col}" = "${t.col}"`);
        if (upd.ok && upd.count > 0) out.push(`${t.name}: гость изменил строк ${upd.count}`);
      }
      const del = await attempt(tx, `delete from ${q(t.name)}`);
      if (del.ok && del.count > 0) out.push(`${t.name}: гость удалил строк ${del.count}`);
    }
    return out;
  });
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("чужой клиент (вошедший без ролей и своих данных): видит 0 строк везде и ничего не пишет", async () => {
  const stranger = randomUUID();
  const problems = await as("authenticated", stranger, async (tx) => {
    const out = [];
    for (const t of tables) {
      const sel = await attempt(tx, `select count(*)::int as n from ${q(t.name)}`);
      if (sel.ok && sel.rows[0].n > 0 && !PUBLIC_READ.has(t.name)) out.push(`${t.name}: чужой клиент видит строк ${sel.rows[0].n}`);
      const ins = await attempt(tx, `insert into ${q(t.name)} default values`);
      if (ins.ok) out.push(`${t.name}: вставил строку`);
      if (t.col) {
        const upd = await attempt(tx, `update ${q(t.name)} set "${t.col}" = "${t.col}"`);
        if (upd.ok && upd.count > 0) out.push(`${t.name}: изменил строк ${upd.count}`);
      }
      const del = await attempt(tx, `delete from ${q(t.name)}`);
      if (del.ok && del.count > 0) out.push(`${t.name}: удалил строк ${del.count}`);
    }
    return out;
  });
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("клиент с данными (демо client@): видит только своё — по user_id, заказу, обращению или проекту; писать не может", async (t) => {
  if (!clientId) return t.skip("нет демо-аккаунта client@example.com");
  // 1) Что видит клиент: адреса строк (ctid) каждой таблицы — от имени клиента. 2) Чьи это строки — проверяем уже
  // без RLS (RESET ROLE в той же транзакции): подзапросы к заказам и проектам от имени клиента чужое бы скрыли.
  const problems = await as("authenticated", clientId, async (tx) => {
    const out = [];
    const seen = {};
    for (const tb of tables) {
      const sel = await attempt(tx, `select coalesce(array_agg(ctid), '{}')::text as ids, count(*)::int as n from ${q(tb.name)}`);
      if (sel.ok) seen[tb.name] = sel.rows[0];
    }
    await tx.unsafe("reset role");
    for (const tb of tables) {
      const s = seen[tb.name];
      if (!s || !s.n) continue;
      const links = tb.links || [];
      const foreign = [
        tb.name === "profiles" ? `x.id <> '${clientId}'` : null,
        links.includes("user_id") ? `x.user_id is distinct from '${clientId}'` : null,
        links.includes("order_id") ? `exists (select 1 from public.orders o where o.id = x.order_id and o.user_id is distinct from '${clientId}')` : null,
        links.includes("interaction_id") ? `exists (select 1 from public.interactions i where i.id = x.interaction_id and i.user_id is distinct from '${clientId}')` : null,
        links.includes("project_id") ? `exists (select 1 from public.projects p where p.id = x.project_id and p.user_id is distinct from '${clientId}')` : null,
      ].filter(Boolean);
      if (!foreign.length) {
        if (!PUBLIC_READ.has(tb.name)) out.push(`${tb.name}: у таблицы нет владельца (user_id, order_id…), но клиент видит строк ${s.n}`);
        continue;
      }
      const f = await attempt(tx, `select count(*)::int as n from ${q(tb.name)} x where x.ctid = any ('${s.ids}'::tid[]) and (${foreign.join(" or ")})`);
      if (!f.ok) out.push(`${tb.name}: проверка владельца не выполнилась: ${f.error}`);
      else if (f.rows[0].n > 0) out.push(`${tb.name}: клиент видит чужих строк ${f.rows[0].n} из ${s.n}`);
    }
    return out;
  });
  const writes = await as("authenticated", clientId, async (tx) => {
    const out = [];
    for (const tb of tables) {
      const ins = await attempt(tx, `insert into ${q(tb.name)} default values`);
      if (ins.ok) out.push(`${tb.name}: клиент вставил строку напрямую`);
      if (tb.col) {
        const upd = await attempt(tx, `update ${q(tb.name)} set "${tb.col}" = "${tb.col}"`);
        if (upd.ok && upd.count > 0) out.push(`${tb.name}: клиент напрямую изменил строк ${upd.count}`);
      }
      const del = await attempt(tx, `delete from ${q(tb.name)}`);
      if (del.ok && del.count > 0) out.push(`${tb.name}: клиент напрямую удалил строк ${del.count}`);
    }
    return out;
  });
  assert.deepEqual([...problems, ...writes], [], [...problems, ...writes].join("\n"));
});

test("гость через настоящий API Supabase (ключ гостя): каждая таблица — отказ или пусто, запись — отказ", async () => {
  const anon = supabaseAnon();
  const problems = [];
  for (const t of tables) {
    const { data, error } = await anon.from(t.name).select("*").limit(1);
    if (!error && data?.length && !PUBLIC_ALL_READ.has(t.name)) problems.push(`${t.name}: гость читает через API`);
    const ins = await anon.from(t.name).insert({}).select();
    if (!ins.error) problems.push(`${t.name}: гость вставил через API`);
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});
