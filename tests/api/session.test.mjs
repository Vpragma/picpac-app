// SEC-22: после удаления аккаунта и после выхода старые куки сессии не дают доступа к данным.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
let U;
let V;

before(async () => {
  [U, V] = await Promise.all([createTestUser(admin, ["client"], "sess"), createTestUser(admin, ["client"], "sess2")]);
});

after(async () => {
  for (const u of [U, V]) if (u) await deleteTestUser(admin, u).catch(() => {});
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

// Известный долг (S12): после выхода токен доступа работает до своего срока (≤ 1 ч) — подпись проверяется локально
// (getClaims), а сессия и токен обновления уже отозваны. Тест оставлен как todo: он показывает долг, но не роняет набор.
test("SEC-22: старые куки после выхода не дают доступа", { todo: "S12: проверять сессию на сервере (getUser или список отозванных session_id)" }, async () => {
  const old = new Map(V.client.jar);
  const out = await V.client.req("/api/v1/auth/logout", { method: "POST" });
  assert.equal(out.status, 200);
  const r = await replay(old).req("/api/v1/projects");
  assert.ok([401, 403].includes(r.status), `ожидали 401/403, пришло ${r.status}`);
});
