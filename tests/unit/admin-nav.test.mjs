// N7: в меню админки подсвечен только текущий раздел — и во вкладках вверху, и в меню сотрудника (Shell)
import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_SECTIONS, adminSectionOf } from "../../lib/adminNav.js";

test("каждый раздел — сам себе текущий, и только он", () => {
  for (const s of ADMIN_SECTIONS) {
    assert.equal(adminSectionOf(s.href), s.href, s.href);
    const lit = ADMIN_SECTIONS.filter((x) => x.href === adminSectionOf(s.href));
    assert.equal(lit.length, 1, `на ${s.href} подсвечен ровно один пункт`);
  }
});

test("подстраницы относятся к своему разделу: журнал — не «Статистика», заказы — не «Обзор»", () => {
  assert.equal(adminSectionOf("/admin/audit"), "/admin/audit");
  assert.equal(adminSectionOf("/admin/audit?email=a"), "/admin/audit");
  assert.equal(adminSectionOf("/admin/orders"), "/admin/orders");
  assert.equal(adminSectionOf("/admin/orders/5f0c-1"), "/admin/orders");
  assert.equal(adminSectionOf("/admin/orders?moderation=1"), "/admin/orders");
  assert.equal(adminSectionOf("/admin/users/"), "/admin/users");
  assert.equal(adminSectionOf("/admin/catalog"), "/admin/catalog");
  assert.equal(adminSectionOf("/admin/support/42"), "/admin", "чат обращения — страница «Обзора»");
  assert.equal(adminSectionOf("/admin/"), "/admin");
});

test("не админка и похожие адреса — ничего не подсвечено", () => {
  assert.equal(adminSectionOf("/"), null);
  assert.equal(adminSectionOf("/orders"), null);
  assert.equal(adminSectionOf("/administrator"), null);
  assert.equal(adminSectionOf("/admin/push-x"), null);
  assert.equal(adminSectionOf("/admin/unknown"), null);
  assert.equal(adminSectionOf(""), null);
  assert.equal(adminSectionOf(undefined), null);
});
