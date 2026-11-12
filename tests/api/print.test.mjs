// API-тесты S03e: печатная версия изменённого фото. Как делает lib/photo/print.js при оформлении:
// POST …/print (ссылка) → PUT файла в хранилище → PUT …/print { path, edits } → снимок заказа содержит
// правки и путь печатной версии, оригинал хранится отдельно. Плюс отказы: чужое фото, чужой путь, другой размер.
// Создаёт пользователей e2e-…@example.com и удаляет их в конце.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-print-${randomUUID().slice(0, 8)}`;
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url)); // 800×549
const OTHER = readFileSync(new URL("../../public/demo-gallery/cat-dark.jpg", import.meta.url)); // другой размер
const DOUBLE = readFileSync(new URL("../../public/demo-gallery/nesvizh.jpg", import.meta.url)); // 1600×1098 — ровно ×2
const recipient = { name: "Тест Тестович", phone: "+375 (29) 000-00-00" };
const EDITS = { v: 1, auto: null, autoOff: false, manual: { exposure: 20, warmth: 10 }, ops: [], by: "command" };

let C; // клиент
let X; // другой клиент
const s = {};

before(async () => {
  C = await createTestUser(admin, ["client"], "print");
  X = await createTestUser(admin, ["client"], "print-x");
  const p = await C.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", options: { size: "20x20", pages: 20, settings: { quantity: 1 } } } });
  assert.equal(p.status, 201, p.text);
  s.project = p.json.project;
  const u = await C.client.req(`/api/v1/projects/${s.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length, name: "x.jpg" } });
  assert.equal(u.status, 200, u.text);
  assert.ok((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG })).ok);
  const c = await C.client.req(`/api/v1/projects/${s.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(c.status, 201, c.text);
  s.photo = c.json.photo;
  s.original = u.json.upload.path;
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  await deleteTestUser(admin, C);
  await deleteTestUser(admin, X);
});

const printUrl = (user, bytes = JPEG.length, photoId = s.photo.id) =>
  user.client.req(`/api/v1/projects/${s.project.id}/photos/${photoId}/print`, { method: "POST", body: { bytes } });
const save = (user, body) => user.client.req(`/api/v1/projects/${s.project.id}/photos/${s.photo.id}/print`, { method: "PUT", body });

test("печатная версия: чужое фото → 404", async () => {
  assert.equal((await printUrl(X)).status, 404);
  assert.equal((await save(X, { path: null })).status, 404);
});

test("печатная версия: чужой путь и файл другого размера не принимаются", async () => {
  const foreign = await save(C, { path: s.original, edits: EDITS });
  assert.equal(foreign.status, 400, foreign.text);
  assert.equal(foreign.json.error.code, "invalid_path");
  const u = await printUrl(C, OTHER.length);
  assert.equal(u.status, 200, u.text);
  assert.ok((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: OTHER })).ok);
  const r = await save(C, { path: u.json.upload.path, edits: EDITS });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.error.code, "size_mismatch");
});

test("печатная версия удаляется вместе с фото", async () => {
  // Второй проект: фото + печатная версия → DELETE фото → обоих файлов в хранилище нет
  const p = await C.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "photo", options: { size: "10x15", settings: { quantity: 1 } } } });
  assert.equal(p.status, 201, p.text);
  const pid = p.json.project.id;
  const u = await C.client.req(`/api/v1/projects/${pid}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  assert.ok((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG })).ok);
  const c = await C.client.req(`/api/v1/projects/${pid}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(c.status, 201, c.text);
  const ph = c.json.photo.id;
  const pu = await C.client.req(`/api/v1/projects/${pid}/photos/${ph}/print`, { method: "POST", body: { bytes: JPEG.length } });
  assert.equal(pu.status, 200, pu.text);
  assert.ok((await fetch(pu.json.upload.url, { method: "PUT", headers: pu.json.upload.headers, body: JPEG })).ok);
  const sv = await C.client.req(`/api/v1/projects/${pid}/photos/${ph}/print`, { method: "PUT", body: { path: pu.json.upload.path, edits: EDITS } });
  assert.equal(sv.status, 200, sv.text);
  const del = await C.client.req(`/api/v1/projects/${pid}/photos/${ph}`, { method: "DELETE" });
  assert.equal(del.status, 200, del.text);
  for (const path of [u.json.upload.path, pu.json.upload.path]) {
    const { data } = await admin.storage.from("photos").list(path.split("/").slice(0, -1).join("/"), { search: path.split("/").pop() });
    assert.equal((data || []).length, 0, `файл остался: ${path}`);
  }
});

test("D1: «Резкость для печати» — принимается файл ровно ×2 только с правкой upscale = 2", async () => {
  const up = async (buf, edits) => {
    const u = await printUrl(C, buf.length);
    assert.equal(u.status, 200, u.text);
    assert.ok((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: buf })).ok);
    return save(C, { path: u.json.upload.path, edits });
  };
  const ok = await up(DOUBLE, { ...EDITS, upscale: 2 });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.print.width, 1600);
  assert.equal(ok.json.print.height, 1098);
  // ×2 без правки — другой размер; правка ×2, а файл того же размера — тоже нет
  const noFlag = await up(DOUBLE, EDITS);
  assert.equal(noFlag.status, 400, noFlag.text);
  assert.equal(noFlag.json.error.code, "size_mismatch");
  const sameSize = await up(JPEG, { ...EDITS, upscale: 2 });
  assert.equal(sameSize.status, 400, sameSize.text);
  assert.match(sameSize.json.error.message, /вдвое/);
});

test("печатная версия: файл того же размера + правки → в снимке заказа, оригинал отдельно", async () => {
  const u = await printUrl(C);
  assert.equal(u.status, 200, u.text);
  assert.match(u.json.upload.path, new RegExp(`/${s.project.id}/print/${s.photo.id}/[0-9a-f-]{36}\\.jpg$`));
  assert.ok((await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG })).ok);
  const r = await save(C, { path: u.json.upload.path, edits: EDITS });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.print.width, 800);
  assert.equal(r.json.print.height, 549);
  s.print = u.json.upload.path;

  const cart = await C.client.req("/api/v1/cart", { method: "PUT", body: { items: [{ projectId: s.project.id, quantity: 1 }] } });
  assert.equal(cart.status, 200, cart.text);
  const o = await C.client.req("/api/v1/orders", {
    method: "POST",
    headers: { "idempotency-key": `${RUN}-a` },
    body: { delivery: { code: "europost", address: { pickup_point: "Минск, пункт 1" } }, recipient },
  });
  assert.equal(o.status, 201, o.text);
  const { data: items } = await admin.from("order_items").select("snapshot").eq("order_id", o.json.order.id);
  const ph = items[0].snapshot.photos.find((x) => x.id === s.photo.id);
  assert.equal(ph.path, s.original, "оригинал хранится отдельно");
  assert.equal(ph.edits.print.path, s.print, "печатная версия в данных заказа");
  assert.equal(ph.edits.manual.exposure, 20, "правки в данных заказа");
  const { data: row } = await admin.from("project_photos").select("print_path").eq("id", s.photo.id).single();
  assert.equal(row.print_path, s.print);
  // Заказанный проект менять нельзя
  assert.equal((await save(C, { path: null })).status, 409);
});
