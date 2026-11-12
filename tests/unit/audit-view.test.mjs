// N9: журнал без шума — группировка одинаковых событий подряд, страницы групп, «кто это» (люди, система, ERP, автотесты)
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditActor, auditGroupKey, groupAudit, isTestRow, pageGroups } from "../../lib/auditView.js";

let id = 1000;
const row = (over = {}) => ({ id: id--, at: "2026-11-12T20:00:00Z", user_id: "u1", role: "client", action: "photo.add", object_type: "photo", object_id: String(id), result: "success", details: {}, ip: null, ...over });

test("одинаковые события подряд — одна группа, номер объекта не важен", () => {
  const rows = [row(), row(), row(), row({ action: "cart.update", object_type: "cart" }), row()];
  const g = groupAudit(rows);
  assert.deepEqual(g.map((x) => x.items.length), [3, 1, 1], "photo.add ×3, cart.update, снова photo.add — отдельно (не подряд)");
});

test("разные люди, результат или роль — разные группы; гость — по IP", () => {
  const a = row({ user_id: null, role: null, action: "access.denied", object_type: "route", ip: "10.0.0.1", result: "denied" });
  const b = row({ user_id: null, role: null, action: "access.denied", object_type: "route", ip: "10.0.0.2", result: "denied" });
  assert.notEqual(auditGroupKey(a), auditGroupKey(b));
  assert.notEqual(auditGroupKey(row()), auditGroupKey(row({ user_id: "u2" })));
  assert.notEqual(auditGroupKey(row()), auditGroupKey(row({ result: "error" })));
  assert.notEqual(auditGroupKey(row()), auditGroupKey(row({ role: "admin" })));
});

test("страница групп: больше страницы — курсор на последней строке последней показанной группы", () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row({ user_id: "u" + i }), row({ user_id: "u" + i }));
  const { groups, next } = pageGroups(rows, { pageSize: 3, moreRows: true });
  assert.equal(groups.length, 3);
  assert.equal(next, groups[2].items.at(-1).id);
  assert.ok(groups.every((g) => g.items.length === 2));
});

test("страница групп: последняя группа окна переносится целиком, если строки ещё есть", () => {
  const rows = [row({ user_id: "a" }), row({ user_id: "b" }), row({ user_id: "b" })];
  const more = pageGroups(rows, { pageSize: 50, moreRows: true });
  assert.equal(more.groups.length, 1, "группа b может продолжаться — на следующую страницу");
  assert.equal(more.next, rows[0].id);
  const end = pageGroups(rows, { pageSize: 50, moreRows: false });
  assert.equal(end.groups.length, 2);
  assert.equal(end.next, null);
  const single = pageGroups([row({ user_id: "c" }), row({ user_id: "c" })], { pageSize: 50, moreRows: true });
  assert.equal(single.groups.length, 1, "одна длинная группа — показываем, курсор дальше");
  assert.ok(single.next);
});

test("кто совершил: автотест, ERP, система, человек", () => {
  assert.equal(auditActor(row({ details: { email: "e2e-x@example.com" } })), "test");
  assert.equal(auditActor(row({ details: { email: "night2-n9@example.com" } })), "test");
  assert.equal(auditActor(row({ ip: "127.0.0.1" })), "test");
  assert.equal(auditActor(row({ is_test: true })), "test", "удалённый тестовый аккаунт (признак из базы)");
  assert.equal(auditActor(row({ action: "erp.event", user_id: null })), "erp");
  assert.equal(auditActor(row({ action: "cron.cart_reminders", user_id: null })), "system");
  assert.equal(auditActor(row({ action: "notify.cart_reminder" })), "system");
  assert.equal(auditActor(row({ action: "auth.login", details: { email: "client@example.com" } })), "human");
  assert.equal(isTestRow(row({ details: { test: "x" } })), true);
});
