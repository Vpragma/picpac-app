// Демо-данные PicPac (S10). Без реальных людей: имена собраны из списков, телефоны +375 (00) — несуществующий код,
// почты synthetic-NNN@example.com. Всё помечено is_synthetic / is_demo. Журнал действий не трогаем.
//   npm run seed:synthetic — синтетический набор (ТЗ, раздел 8): 200 клиентов, 520 заказов за 60 дней во всех 5 статусах,
//                            320 обращений с темами и SLA, события воронки. Детерминированно (seed 20261112).
//   npm run seed:demo      — синтетический набор + «живые» демо-аккаунты жюри (проекты, заказы во всех статусах, обращение с ответом).
//   node scripts/demo-data.mjs demo-accounts — только демо-данные client@example.com, синтетику не трогает
//   npm run reset:demo     — удалить is_demo/is_synthetic строки, синтетических, e2e- и critic-пользователей с их файлами,
//                            затем снова загрузить демо. С флагом --clean — только удалить, --dry-run — только посчитать.
// Повторный запуск любой команды безопасен: старые синтетические и демо-строки сначала удаляются.
// Пароли демо-аккаунтов не меняются (их создаёт npm run seed).
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mode = process.argv[2] || "demo";
const cleanOnly = process.argv.includes("--clean");
const dryRun = process.argv.includes("--dry-run");
const allUsers = process.argv.includes("--all");

const need = (...names) => {
  for (const n of names) if (process.env[n]) return process.env[n];
  console.error(`Нет переменной ${names[0]}. Выполните в папке проекта: vercel env pull .env.local`);
  process.exit(1);
};
const sql = postgres(need("POSTGRES_URL_NON_POOLING"), { max: 4, connect_timeout: 30, onnotice: () => {} });
const admin = createClient(need("SUPABASE_URL"), need("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const SALT = need("ANALYTICS_SALT");
const userHash = (id) => createHash("sha256").update(SALT + ":" + id).digest("hex");

// ───── Детерминированный генератор ─────
function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = mulberry32(20261112);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;
const hex = (n) => Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join("");
// Логнормальная длительность вокруг медианы (мс)
const dur = (medianSec) => Math.round(medianSec * 1000 * Math.exp((rnd() + rnd() + rnd() - 1.5) * 0.9));
const DAY = 86400000;

const FIRST = ["Анна", "Мария", "Ольга", "Ирина", "Елена", "Наталья", "Дарья", "Алина", "Вера", "Полина", "Алексей", "Дмитрий", "Сергей", "Андрей", "Павел", "Максим", "Иван", "Никита", "Егор", "Артём"];
const LAST_F = ["Ковалёва", "Новик", "Шевчук", "Мельник", "Козлова", "Лукашевич", "Бондаренко", "Жук", "Савицкая", "Климович"];
const LAST_M = ["Ковалёв", "Новик", "Шевчук", "Мельник", "Козлов", "Лукашевич", "Бондаренко", "Жук", "Савицкий", "Климович"];
const CITIES = ["Минск", "Гомель", "Брест", "Гродно", "Витебск", "Могилёв", "Барановичи", "Пинск"];
const TOPICS = [
  ["Где мой заказ?", "support", "Подскажите, когда приедет заказ?", "Заказ уже в пути, курьер позвонит заранее."],
  ["Изменить адрес доставки", "support", "Можно поменять адрес доставки?", "Адрес обновили, доставка в тот же срок."],
  ["Сроки изготовления", "support", "Успеете к выходным?", "Да, книга будет готова к пятнице."],
  ["Промокод не сработал", "support", "Промокод не применился к заказу.", "Проверили: скидка учтена в сумме заказа."],
  ["Оплата и чек", "support", "Где посмотреть чек?", "Чек (тест) — в деталях заказа."],
  ["Брак печати: полосы на развороте", "reprint", "На одном развороте полосы.", "Перепечатаем разворот бесплатно, отправим за 3 дня."],
  ["Перепечатка: замятая страница", "reprint", "Одна страница замята.", "Оформили перепечатку, извините за неудобство."],
];
const STATUSES = ["accepted", "moderation", "production", "shipped", "done"];
const EDITOR_STEPS = ["photos", "layout", "edits", "check"];
const STEP_MEDIAN = { photos: 95, layout: 130, edits: 160, check: 50 };

async function pool(items, size, fn) {
  const out = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k], k);
      }
    }),
  );
  return out;
}

async function listAllUsers() {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("Список пользователей: " + error.message);
    all.push(...data.users);
    if (data.users.length < 1000) break;
  }
  return all;
}

// Удалить файлы пользователя в Storage (вглубь папок) или одной папки проекта
async function removeFiles(prefix, depth = 1) {
  const { data: items } = await admin.storage.from("photos").list(prefix, { limit: 1000 });
  const paths = [];
  for (const x of items || []) {
    if (x.id) paths.push(`${prefix}/${x.name}`);
    else if (depth < 4) await removeFiles(`${prefix}/${x.name}`, depth + 1);
  }
  if (paths.length) await admin.storage.from("photos").remove(paths);
  return paths.length;
}

// ───── Каталог: цены для правдоподобных сумм ─────
async function catalog() {
  const products = await sql`select slug, name, kind, base_price_kop, min_pages from products`;
  const sizes = await sql`select product_slug, code, price_k, unit_price_kop from product_sizes where active`;
  const delivery = await sql`select code, price_kop from delivery_methods`;
  return { products, sizes, delivery };
}

// ───── Синтетические клиенты ─────
async function syntheticUsers(existing) {
  const want = Array.from({ length: 200 }, (_, i) => `synthetic-${String(i + 1).padStart(3, "0")}@example.com`);
  const byEmail = new Map(existing.map((u) => [u.email, u]));
  const missing = want.filter((e) => !byEmail.has(e));
  let created = 0;
  await pool(missing, 8, async (email) => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      // Случайный пароль нигде не сохраняется: синтетические клиенты не входят в приложение
      password: randomBytes(24).toString("base64url"),
      email_confirm: true,
      app_metadata: { synthetic: true },
    });
    if (error) throw new Error(`Синтетический клиент ${email}: ${error.message}`);
    byEmail.set(email, data.user);
    created++;
  });
  const users = want.map((email, i) => {
    const female = i % 2 === 0;
    const name = `${FIRST[(i * 7) % 10 + (female ? 0 : 10)]} ${(female ? LAST_F : LAST_M)[(i * 3) % 10]}`;
    return { id: byEmail.get(email).id, email, name, phone: `+375 (00) ${String(1000000 + i).slice(1, 4)}-${String(i).padStart(2, "0").slice(-2)}-${String(i * 7 % 100).padStart(2, "0")}`, city: CITIES[i % CITIES.length] };
  });
  const rows = users.map((u) => ({ id: u.id, full_name: u.name, is_synthetic: true }));
  await sql`insert into public.profiles ${sql(rows, "id", "full_name", "is_synthetic")}
            on conflict (id) do update set full_name = excluded.full_name, is_synthetic = true`;
  return { users, created };
}

function priceFor(cat, slug, size) {
  const p = cat.products.find((x) => x.slug === slug);
  const s = cat.sizes.find((x) => x.product_slug === slug && x.code === size);
  if (p?.kind === "book") return Math.round(((p.base_price_kop || 7000) * Number(s?.price_k || 1)) / 10) * 10;
  return s?.unit_price_kop || 90;
}

// Заказ со всем, что к нему относится: позиция, лента статусов, обращение, модерация
function makeOrder(cat, u, createdAt, now, opts = {}) {
  const book = chance(0.6);
  const slug = opts.slug || (book ? pick(["pages-book", "pages-book", "layflat", "photopaper-book"]) : pick(["photo", "photo", "digital"]));
  const p = cat.products.find((x) => x.slug === slug);
  const sizesOf = cat.sizes.filter((s) => s.product_slug === slug);
  const size = (sizesOf[0] && pick(sizesOf).code) || "20x20";
  const isBook = p?.kind === "book";
  const quantity = isBook ? (chance(0.85) ? 1 : 2) : int(10, 60);
  const unit = priceFor(cat, slug, size);
  const goods = unit * quantity;
  const del = pick(cat.delivery);
  const discount = chance(0.15) ? Math.round(goods * 0.1) : 0;
  const delivery = goods - discount >= 10000 ? 0 : del.price_kop;
  const ageDays = (now - createdAt) / DAY;
  // Статус по «возрасту» заказа: старые — завершены, свежие — в работе. Немного просроченных.
  let status;
  if (opts.status) status = opts.status;
  else if (ageDays > 9) status = chance(0.95) ? "done" : "shipped";
  else if (ageDays > 5) status = pick(["shipped", "done", "done", "production"]);
  else if (ageDays > 1) status = pick(["production", "production", "shipped", "moderation"]);
  else status = pick(["accepted", "moderation", "moderation", "production"]);
  const paid = status !== "accepted" || chance(0.4);
  const printDays = isBook ? 5 : 2;
  const id = randomUUID();
  const reached = STATUSES.slice(0, STATUSES.indexOf(status) + 1);
  let t = createdAt;
  const history = reached.map((s, i) => {
    if (i > 0) t += (s === "moderation" ? 0.1 : s === "production" ? 0.6 : s === "shipped" ? printDays : 2) * DAY * (0.6 + rnd() * 0.8);
    t = Math.min(t, now - 60000);
    return { order_id: id, status: s, at: new Date(t).toISOString(), source: s === "moderation" ? "system" : "erp", reason: null };
  });
  const etaFrom = createdAt + (printDays + 1) * DAY;
  // Немного просроченных: в производстве дольше срока
  const overdue = status === "production" && ageDays > 5;
  const order = {
    id,
    user_id: u.id,
    idempotency_key: `synthetic-${hex(16)}`,
    recipient: { name: u.name, phone: u.phone, email: u.email },
    delivery_code: del.code,
    delivery_address: { city: u.city, street: "ул. Тестовая", house: String(int(1, 99)), flat: String(int(1, 200)) },
    goods_kop: goods,
    discount_kop: discount,
    delivery_kop: delivery,
    total_kop: goods - discount + delivery,
    promo_code: discount ? "TEST10" : null,
    payment_method: paid ? pick(["card_test", "erip_test"]) : null,
    payment_status: paid ? "paid_test" : "unpaid",
    paid_at: paid ? new Date(createdAt + 60000 * int(1, 10)).toISOString() : null,
    status,
    substatus: status === "production" ? pick(["Печать", "Сборка", "Упаковка"]) : null,
    status_changed_at: history[history.length - 1].at,
    eta_from: new Date(etaFrom).toISOString(),
    eta_to: new Date(overdue ? Math.min(etaFrom + DAY, now - DAY) : etaFrom + 2 * DAY).toISOString(),
    is_demo: false,
    is_synthetic: true,
    created_at: new Date(createdAt).toISOString(),
    updated_at: history[history.length - 1].at,
  };
  const photos = isBook ? int(20, 80) : quantity;
  const item = {
    order_id: id,
    product_slug: slug,
    title: opts.title || (isBook ? pick(["Отпуск", "Наша свадьба", "Первый год", "Выпускной", "Лето у бабушки", "Путешествие"]) : "Печать фото"),
    options: isBook ? { size, pages: Math.max(p.min_pages || 20, 24), cover: "gloss" } : { size, print: "photochemical", surface: "gloss" },
    quantity,
    unit_price_kop: unit,
    line_total_kop: goods,
    snapshot: { kind: isBook ? "book" : "print", productName: p?.name || slug, photoCount: photos, printDays, synthetic: true },
  };
  return { order, item, history, paid, createdAt };
}

function makeInteraction(order, createdAt, now, u, opts = {}) {
  const [topic, kind, ask, answer] = opts.topic || pick(TOPICS);
  const age = (now - createdAt) / DAY;
  const status = opts.status || (age > 3 ? (chance(0.8) ? "closed" : "answered") : age > 1 ? pick(["answered", "answered", "open"]) : pick(["open", "open", "answered"]));
  const id = randomUUID();
  const slaHours = kind === "reprint" ? 48 : 24;
  const messages = [{ interaction_id: id, author_kind: "client", body: ask, created_at: new Date(createdAt).toISOString() }];
  if (status !== "open") messages.push({ interaction_id: id, author_kind: "operator", body: answer, created_at: new Date(Math.min(createdAt + int(1, slaHours - 2) * 3600000, now - 60000)).toISOString() });
  return {
    row: {
      id,
      order_id: order.id,
      user_id: u.id,
      topic,
      kind,
      status,
      sla_due: new Date(createdAt + slaHours * 3600000).toISOString(),
      created_at: new Date(createdAt).toISOString(),
      updated_at: messages[messages.length - 1].created_at,
    },
    messages,
  };
}

// События воронки: у каждого оплаченного заказа — полная цепочка, плюс сеансы, которые остановились раньше
function funnelEvents(orders, users, now) {
  const ev = [];
  const push = (type, sid, uh, at, extra = {}) => ev.push({ type, session_id: sid, user_hash: uh, step: extra.step || null, duration_ms: extra.duration_ms ?? null, props: extra.props || {}, is_synthetic: true, at: new Date(at).toISOString() });
  // Шаги редактора до stopAt (включительно); возвращает время после шагов
  const editor = (sid, uh, t, stopAt = 3) => {
    for (let i = 0; i <= stopAt; i++) {
      const d = dur(STEP_MEDIAN[EDITOR_STEPS[i]]);
      t += d;
      push("editor_step", sid, uh, t, { step: EDITOR_STEPS[i], duration_ms: d });
    }
    return t;
  };
  const session = (t0, uh, depth, slug, order) => {
    const sid = hex(16);
    let t = t0;
    push("product_view", sid, uh, t, { props: { product: slug } });
    if (chance(0.3)) push("product_view", sid, uh, (t += 20000), { props: { product: pick(["pages-book", "layflat", "photo"]) } });
    if (depth < 1) return;
    push("project_create", sid, uh, (t += 30000), { props: { product: slug } });
    push("photo_upload", sid, uh, (t += 40000), { props: { count: int(4, 60) } });
    const stopAt = depth >= 2 ? 3 : pick([0, 0, 0, 1, 1, 2, 2, 2, 3]);
    if (chance(0.45)) push("ai_edit", sid, uh, t + 1000, { props: { kind: "auto", count: int(1, 8) } });
    if (chance(0.3)) push("ai_edit", sid, uh, t + 2000, { props: { kind: "command" } });
    t = editor(sid, uh, t, stopAt);
    if (depth < 2) return;
    push("cart_add", sid, uh, (t += 5000), { props: { product: slug } });
    if (depth < 3) return;
    push("checkout_start", sid, uh, (t += 60000));
    if (depth < 4 || !order) return;
    push("order_created", sid, uh, order.createdAt, { props: { product: slug } });
    if (order.paid) push("payment_test", sid, uh, new Date(order.order.paid_at).getTime(), { props: { method: order.order.payment_method } });
  };
  // Цепочки заказов
  for (const o of orders) {
    const uh = userHash(o.order.user_id);
    session(o.createdAt - 15 * 60000 - int(0, 40) * 60000, uh, 4, o.item.product_slug, o);
  }
  // Не дошедшие до заказа: остановились на оформлении, корзине, в редакторе или после просмотра
  const span = 60 * DAY;
  const extra = [
    [70, 3],
    [230, 2],
    [560, 1],
    [1750, 0],
  ];
  for (const [count, depth] of extra) {
    for (let i = 0; i < count; i++) {
      const t0 = now - span + Math.floor(rnd() * (span - 3600000));
      const uh = depth >= 2 && chance(0.7) ? userHash(pick(users).id) : null;
      session(t0, uh, depth, pick(["pages-book", "pages-book", "layflat", "photopaper-book", "photo", "digital"]), null);
    }
  }
  return ev;
}

async function insertChunks(table, rows, size = 2000) {
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    await sql`insert into ${sql(table)} ${sql(part)}`;
  }
}

// Номер заказа — дата создания по Минску + общий счётчик (как у настоящих заказов)
async function insertOrders(tx, list) {
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    await tx`
      insert into public.orders (id, number, user_id, idempotency_key, recipient, delivery_code, delivery_address, goods_kop, discount_kop,
        delivery_kop, total_kop, promo_code, payment_method, payment_status, paid_at, status, substatus, status_changed_at, eta_from, eta_to,
        is_demo, is_synthetic, created_at, updated_at)
      select id, 'PP-' || to_char(created_at at time zone 'Europe/Minsk', 'YYMMDD') || '-' || lpad(nextval('public.order_number_seq')::text, 5, '0'),
        user_id, idempotency_key, recipient, delivery_code, delivery_address, goods_kop, discount_kop, delivery_kop, total_kop, promo_code,
        payment_method, payment_status, paid_at, status, substatus, status_changed_at, eta_from, eta_to, is_demo, is_synthetic, created_at, updated_at
      from jsonb_to_recordset(${tx.json(part)}) as x(id uuid, user_id uuid, idempotency_key text, recipient jsonb, delivery_code text,
        delivery_address jsonb, goods_kop int, discount_kop int, delivery_kop int, total_kop int, promo_code text, payment_method text,
        payment_status text, paid_at timestamptz, status text, substatus text, status_changed_at timestamptz, eta_from timestamptz,
        eta_to timestamptz, is_demo boolean, is_synthetic boolean, created_at timestamptz, updated_at timestamptz)
      order by created_at`;
  }
}

async function seedSynthetic(cat, existingUsers) {
  rnd = mulberry32(20261112);
  const { users, created } = await syntheticUsers(existingUsers);
  const ids = users.map((u) => u.id);
  // Повторный запуск: убрать прошлый синтетический набор (заказы каскадом уносят позиции, ленту и обращения)
  await sql`delete from public.orders where is_synthetic and user_id = any(${ids}::uuid[])`;
  await sql`delete from public.analytics_events where is_synthetic`;
  const now = Date.now();
  const orders = [];
  for (let i = 0; i < 520; i++) {
    // Больше заказов в последние недели и по выходным
    const back = Math.pow(rnd(), 0.9) * 60 * DAY;
    let createdAt = now - back;
    const wd = new Date(createdAt).getUTCDay();
    if ((wd === 1 || wd === 2) && chance(0.3)) createdAt -= DAY;
    const u = users[i < 200 ? i : int(0, 199)];
    orders.push(makeOrder(cat, u, Math.max(createdAt, now - 60 * DAY + 3600000), now));
  }
  // Сегодня точно есть свежие заказы
  for (let i = 0; i < 3; i++) orders.push(makeOrder(cat, users[int(0, 199)], now - int(10, 300) * 60000, now));
  const interactions = [];
  const messages = [];
  const withTopics = [...orders].sort(() => rnd() - 0.5).slice(0, 320);
  for (const o of withTopics) {
    const at = Math.min(o.createdAt + int(1, 96) * 3600000, now - int(5, 600) * 60000);
    const it = makeInteraction(o.order, at, now, users.find((x) => x.id === o.order.user_id));
    interactions.push(it.row);
    messages.push(...it.messages);
  }
  const reviews = orders
    .filter((o) => o.order.status === "moderation")
    .slice(0, 8)
    .map((o) => ({ order_id: o.order.id, auto_flag: true, auto_scores: { sexy: 0.9, synthetic: true }, decision: "pending" }));
  const events = funnelEvents(orders, users, now);

  await sql.begin(async (tx) => {
    await insertOrders(tx, orders.map((o) => o.order));
    const items = orders.map((o) => o.item);
    for (let i = 0; i < items.length; i += 500) await tx`insert into public.order_items ${tx(items.slice(i, i + 500))}`;
    const hist = orders.flatMap((o) => o.history);
    for (let i = 0; i < hist.length; i += 1000) await tx`insert into public.order_status_history ${tx(hist.slice(i, i + 1000))}`;
    await tx`insert into public.interactions ${tx(interactions)}`;
    for (let i = 0; i < messages.length; i += 1000) await tx`insert into public.interaction_messages ${tx(messages.slice(i, i + 1000))}`;
    if (reviews.length) await tx`insert into public.moderation_reviews ${tx(reviews)}`;
    for (let i = 0; i < events.length; i += 2000) await tx`insert into public.analytics_events ${tx(events.slice(i, i + 2000))}`;
  });
  const statusCount = Object.fromEntries(STATUSES.map((s) => [s, orders.filter((o) => o.order.status === s).length]));
  console.log(`Синтетика: клиентов ${users.length} (новых ${created}), заказов ${orders.length} (${Object.entries(statusCount).map(([k, v]) => `${k} ${v}`).join(", ")}), обращений ${interactions.length} (без ответа ${interactions.filter((x) => x.status === "open").length}), событий ${events.length}`);
  return { users, orders: orders.length, interactions: interactions.length, events: events.length };
}

// ───── Демо-аккаунты жюри ─────
async function seedDemoAccounts(cat, existingUsers) {
  rnd = mulberry32(42);
  const find = (email) => existingUsers.find((u) => u.email === email);
  const client = find("client@example.com");
  if (!client) {
    console.log("Нет client@example.com — сначала npm run seed (создаёт демо-аккаунты с паролем из SEED_PASSWORD).");
    return;
  }
  // Повторный запуск: убрать прошлые демо-заказы и демо-проекты клиента с файлами
  await sql`delete from public.orders where user_id = ${client.id} and (is_demo or is_synthetic)`;
  const oldProjects = await sql`select id from public.projects where user_id = ${client.id} and is_demo`;
  for (const p of oldProjects) await removeFiles(`${client.id}/${p.id}`, 2);
  await sql`delete from public.projects where user_id = ${client.id} and is_demo`;

  const manifest = JSON.parse(readFileSync(join(root, "public/demo-gallery/manifest.json"), "utf8")).items;
  const projects = [
    { title: "Отпуск на море — 12 фото", slug: "pages-book", options: { size: "20x20", pages: 24, cover: "gloss", paper: "thin" }, files: manifest.slice(0, 12) },
    { title: "Печать: котики и собака", slug: "photo", options: { size: "10x15", print: "photochemical", surface: "gloss", quantity: 1 }, files: manifest.filter((m) => /cat|dog/.test(m.file)).slice(0, 4) },
  ];
  let uploaded = 0;
  const projectRows = [];
  for (const pr of projects) {
    const [row] = await sql`insert into public.projects (user_id, product_slug, title, options, status, is_demo)
      values (${client.id}, ${pr.slug}, ${pr.title}, ${sql.json({ ...pr.options, settings: { acks: {}, quantity: 1, placement: {} } })}, 'draft', true) returning id`;
    projectRows.push(row.id);
    await pool(pr.files, 4, async (m, i) => {
      const buf = readFileSync(join(root, "public/demo-gallery", m.file));
      const path = `${client.id}/${row.id}/${randomUUID()}.jpg`;
      const { error } = await admin.storage.from("photos").upload(path, buf, { contentType: "image/jpeg", upsert: false });
      if (error) throw new Error(`Загрузка ${m.file}: ${error.message}`);
      uploaded++;
      await sql`insert into public.project_photos (project_id, user_id, storage_path, mime, bytes, width, height, position, quality)
        values (${row.id}, ${client.id}, ${path}, 'image/jpeg', ${buf.length}, ${m.width}, ${m.height}, ${i}, ${sql.json({ w: m.width, h: m.height, name: m.file })})`;
    });
  }
  // Заказы во всех 5 статусах. Помечены is_synthetic (а не is_demo): так демо-тикер их не двигает, и жюри видит все статусы.
  const now = Date.now();
  const u = { id: client.id, name: "Тестовый клиент", phone: "+375 (00) 000-00-01", email: "client@example.com", city: "Минск" };
  const plan = [
    ["accepted", 0.02, "Фото с выпускного", "photo"],
    ["moderation", 0.3, "Лето у бабушки", "pages-book"],
    ["production", 2, "Наша свадьба", "layflat"],
    ["shipped", 6, "Первый год", "photopaper-book"],
    ["done", 20, "Путешествие по Беларуси", "pages-book"],
  ];
  const made = plan.map(([status, daysAgo, title, slug]) => makeOrder(cat, u, now - daysAgo * DAY, now, { status, title, slug }));
  for (const m of made) {
    m.order.eta_to = new Date(Math.max(new Date(m.order.eta_to).getTime(), now + 2 * DAY)).toISOString();
    if (m.order.status === "done") m.order.eta_to = m.order.status_changed_at;
  }
  const doneOrder = made[4];
  const it = makeInteraction(doneOrder.order, doneOrder.createdAt + 3 * DAY, now, u, { topic: TOPICS[5], status: "answered" });
  await sql.begin(async (tx) => {
    await insertOrders(tx, made.map((m) => m.order));
    await tx`insert into public.order_items ${tx(made.map((m) => m.item))}`;
    await tx`insert into public.order_status_history ${tx(made.flatMap((m) => m.history))}`;
    await tx`insert into public.interactions ${tx(it.row)}`;
    await tx`insert into public.interaction_messages ${tx(it.messages)}`;
  });
  console.log(`Демо client@example.com: проектов ${projectRows.length} (фото загружено ${uploaded}), заказов ${made.length} во всех 5 статусах, обращение с ответом оператора`);
}

// ───── Сброс ─────
async function reset(existingUsers) {
  const isTest = (e) => /^(synthetic-\d+|e2e-[a-z0-9-]+|critic-[a-z0-9-]+)@example\.com$/i.test(e || "");
  // Тестовых пользователей моложе 30 минут не трогаем (тест или проверка критика могут ещё идти); --all — удалить и их
  const fresh = (u) => !/^synthetic-/.test(u.email) && Date.now() - new Date(u.created_at).getTime() < 30 * 60000;
  const tests = existingUsers.filter((u) => isTest(u.email));
  const victims = tests.filter((u) => allUsers || !fresh(u));
  const keepIds = tests.filter((u) => !victims.includes(u)).map((u) => u.id);
  if (keepIds.length) console.log(`Пропущено свежих тестовых пользователей (< 30 мин): ${keepIds.length}. Удалить и их: npm run reset:demo -- --all`);
  const ids = victims.map((u) => u.id);
  if (dryRun) {
    const [c] = await sql`select
      (select count(*) from public.orders where (is_demo or is_synthetic or user_id = any(${ids}::uuid[])) and (user_id is null or not user_id = any(${keepIds}::uuid[]))) as orders,
      (select count(*) from public.projects where is_demo) as projects,
      (select count(*) from public.analytics_events where is_synthetic) as events`;
    const kinds = { synthetic: 0, e2e: 0, critic: 0 };
    for (const u of victims) kinds[u.email.split("-")[0]]++;
    console.log(`Пробный сброс (ничего не удалено): заказов ${c.orders}, демо-проектов ${c.projects}, событий ${c.events}, пользователей: синтетических ${kinds.synthetic}, e2e ${kinds.e2e}, critic ${kinds.critic}`);
    return;
  }
  const o1 = await sql`delete from public.orders where (is_demo or is_synthetic or user_id = any(${ids}::uuid[]))
    and (user_id is null or not user_id = any(${keepIds}::uuid[])) returning id`;
  const demoProjects = await sql`select id, user_id from public.projects where is_demo`;
  for (const p of demoProjects) await removeFiles(`${p.user_id}/${p.id}`, 2);
  await sql`delete from public.projects where is_demo`;
  const ev = await sql`delete from public.analytics_events where is_synthetic returning id`;
  let files = 0;
  await pool(victims, 6, async (u) => {
    if (!/^synthetic-/.test(u.email)) files += await removeFiles(u.id, 1);
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) console.log(`Не удалён ${u.email}: ${error.message}`);
  });
  const counts = { synthetic: 0, e2e: 0, critic: 0 };
  for (const u of victims) counts[u.email.split("-")[0]]++;
  console.log(`Сброс: заказов ${o1.length}, демо-проектов ${demoProjects.length}, событий ${ev.length}, пользователей: синтетических ${counts.synthetic}, e2e ${counts.e2e}, critic ${counts.critic} (файлов ${files}). Журнал не тронут.`);
}

try {
  const cat = await catalog();
  let users = await listAllUsers();
  if (mode === "demo-accounts") {
    // Только демо-данные client@example.com (исходные проекты, 5 заказов, обращение); синтетический набор не трогаем
    await seedDemoAccounts(cat, users);
  } else if (mode === "reset") {
    await reset(users);
    if (!cleanOnly && !dryRun) {
      users = await listAllUsers();
      await seedSynthetic(cat, users);
      users = await listAllUsers();
      await seedDemoAccounts(cat, users);
    }
  } else {
    await seedSynthetic(cat, users);
    if (mode === "demo") {
      users = await listAllUsers();
      await seedDemoAccounts(cat, users);
    }
  }
  console.log("Готово.");
} catch (e) {
  console.error("Ошибка:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
