// SEC-22: после удаления аккаунта и после выхода старые куки сессии не дают доступа к данным (D7: session_roles()).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
let U;
let V;
let A;

before(async () => {
  [U, V, A] = await Promise.all([createTestUser(admin, ["client"], "sess"), createTestUser(admin, ["client"], "sess2"), createTestUser(admin, ["admin"], "sess-adm")]);
});

after(async () => {
  for (const u of [U, V, A]) if (u) await deleteTestUser(admin, u).catch(() => {});
});

const replay = (jar) => {
  const c = new Client("старые куки");
  c.jar = new Map(jar);
  return c;
};

test("SEC-22: старые куки после удаления аккаунта не дают доступа (401/403)", async () => {
  assert.equal((await U.client.req("/api/v1/projects")).status, 200);
  const old = new Map(U.client.jar);
  const del = await U.client.req("/api/v1/me", { method: "DELETE", body: { password: U.password } });
  assert.equal(del.status, 200, del.text);
  const r = await replay(old).req("/api/v1/projects");
  assert.ok([401, 403].includes(r.status), `ожидали 401/403, пришло ${r.status}`);
  assert.equal(r.json?.ok, false);
});

// D7: роли выдаёт public.session_roles() только живой сессии (session_id токена есть в auth.sessions).
// Выход удаляет строку сессии — старый токен доступа сразу перестаёт работать, хотя подпись у него ещё верна.
test("SEC-22: старые куки после выхода не дают доступа (API, /me, админка)", async () => {
  const old = new Map(V.client.jar);
  assert.equal((await replay(old).req("/api/v1/projects")).status, 200, "до выхода куки работают");
  const out = await V.client.req("/api/v1/auth/logout", { method: "POST" });
  assert.equal(out.status, 200);
  const r = await replay(old).req("/api/v1/projects");
  assert.ok([401, 403].includes(r.status), `ожидали 401/403, пришло ${r.status}`);
  assert.equal(r.json?.ok, false);
  const me = await replay(old).req("/api/v1/me");
  assert.equal(me.status, 200);
  assert.equal(me.json?.authenticated, false, "после выхода /me не узнаёт пользователя");
});

test("SEC-22: старые куки админа после выхода — 401 в proxy (админка и API админки)", async () => {
  const old = new Map(A.client.jar);
  assert.equal((await replay(old).req("/api/v1/admin/audit?limit=1")).status, 200, "до выхода админка доступна");
  const out = await A.client.req("/api/v1/auth/logout", { method: "POST" });
  assert.equal(out.status, 200);
  const api = await replay(old).req("/api/v1/admin/audit?limit=1");
  assert.equal(api.status, 401, `API админки: ожидали 401, пришло ${api.status}`);
  const page = await replay(old).req("/admin/audit");
  assert.equal(page.status, 401, `страница админки: ожидали 401, пришло ${page.status}`);
});
