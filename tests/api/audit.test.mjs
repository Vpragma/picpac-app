// SEC-15 (D7): фильтры журнала действий — GET с параметрами, POST с почтой в теле, «Показать ещё» курсором.
// Тестовые пользователи e2e-…@example.com удаляются после тестов. Запуск: npm run test:api (BASE_URL — сервер).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const guest = new Client("гость");
let A; // админ
let C; // клиент
const marker = `/e2e-audit-${randomUUID().slice(0, 8)}`;

before(async () => {
  [A, C] = await Promise.all([createTestUser(admin, ["admin"], "audadm"), createTestUser(admin, ["client"], "audcli")]);
  // Синтетическая запись в 23:30 UTC 10.11 = 02:30 11.11 по Минску — для проверки границы дня
  const { error } = await admin.from("audit_log").insert({ at: "2026-11-10T23:30:00Z", action: "access.denied", object_type: "route", object_id: marker, result: "denied", details: { test: "e2e-audit-filter" } });
  assert.equal(error, null, error?.message);
});

after(async () => {
  await Promise.all([deleteTestUser(admin, A), deleteTestUser(admin, C)]);
});

const get = (q) => A.client.req(`/api/v1/admin/audit${q ? "?" + q : ""}`);

test("журнал: без параметров — как раньше (до 100 записей), гость 401, клиент 403", async () => {
  const r = await get("");
  assert.equal(r.status, 200, r.text);
  assert.ok(Array.isArray(r.json.items) && r.json.items.length > 0 && r.json.items.length <= 100);
  assert.equal((await guest.req("/api/v1/admin/audit")).status, 401);
  assert.equal((await C.client.req("/api/v1/admin/audit?action=auth.*")).status, 403);
  assert.equal((await C.client.req("/api/v1/admin/audit", { method: "POST", body: { email: C.email } })).status, 403);
});

test("журнал: группа действий и результат", async () => {
  const r = await get("action=auth.*&result=success&limit=30");
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.items.length > 0, "есть входы тестовых пользователей");
  assert.ok(r.json.items.every((i) => i.action.startsWith("auth.") && i.result === "success"));
  const one = await get("action=auth.login&limit=10");
  assert.ok(one.json.items.every((i) => i.action === "auth.login"));
});

test("журнал: пользователь — полный id и первые 8 знаков", async () => {
  const full = await get(`user=${C.id}`);
  assert.equal(full.status, 200, full.text);
  assert.ok(full.json.items.length > 0, "вход клиента записан");
  assert.ok(full.json.items.every((i) => i.user_id === C.id));
  const short = await get(`user=${C.id.slice(0, 8)}`);
  assert.equal(short.status, 200, short.text);
  assert.ok(short.json.items.some((i) => i.user_id === C.id));
  assert.ok(short.json.items.every((i) => i.user_id.startsWith(C.id.slice(0, 8))));
});

test("журнал: объект и дата по Минску (02:30 по Минску — это следующий день по UTC-календарю)", async () => {
  const inDay = await get(`objectType=route&objectId=${encodeURIComponent(marker)}&from=2026-11-11&to=2026-11-11`);
  assert.equal(inDay.status, 200, inDay.text);
  assert.equal(inDay.json.items.length, 1);
  assert.equal(inDay.json.items[0].object_id, marker);
  const prevDay = await get(`objectId=${encodeURIComponent(marker)}&from=2026-11-10&to=2026-11-10`);
  assert.equal(prevDay.json.items.length, 0, "10.11 по Минску записи нет");
});

test("журнал: «Показать ещё» — курсор без пропусков и повторов", async () => {
  const p1 = await get("limit=3");
  assert.ok(p1.json.next, "есть следующая страница");
  assert.equal(p1.json.next, p1.json.items.at(-1).id, "курсор — последняя показанная запись");
  const p2 = await get(`limit=3&before=${p1.json.next}`);
  const ids = [...p1.json.items, ...p2.json.items].map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length, "без повторов");
  // База общая и журнал пополняется во время теста: новые записи получают id больше верхнего в p1,
  // поэтому эталон — одна страница из 6 записей, начиная с той же верхней записи
  const all = await get(`limit=6&before=${p1.json.items[0].id + 1}`);
  assert.deepEqual(ids, all.json.items.map((i) => i.id), "без пропусков");
});

test("журнал: почта — только телом POST; в адресе почта и лишние параметры → 400", async () => {
  const byMail = await A.client.req("/api/v1/admin/audit", { method: "POST", body: { email: C.email.toUpperCase() } });
  assert.equal(byMail.status, 200, byMail.text);
  assert.ok(byMail.json.items.length > 0, "вход клиента найден по почте");
  assert.ok(byMail.json.items.every((i) => i.details?.email === C.email));
  assert.equal((await get(`email=${encodeURIComponent(C.email)}`)).status, 400);
  assert.equal((await get("foo=1")).status, 400);
  assert.equal((await get("result=maybe")).status, 400);
  assert.equal((await get("user=1'or'1'='1")).status, 400);
  assert.equal((await get("action=auth.%25")).status, 400);
  const foreign = await A.client.req("/api/v1/admin/audit", { method: "POST", body: { email: C.email }, headers: { origin: "https://evil.example" } });
  assert.equal(foreign.status, 403, "чужой сайт не может искать по почте");
});
