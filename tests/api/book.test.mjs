// API-тест N11: оформление книги (шаблон, обложка) хранится в настройках проекта и попадает в заказ —
// в options.settings.book и в снимок order_items.snapshot.book (шаблон с полями автомакета, обложка), чтобы производство
// знало шаблон. Мусор в настройках не проходит в снимок: неизвестный шаблон → «Классика», длинный текст обрезан.
// Запуск: BASE_URL=http://127.0.0.1:3307 npm run test:api (или node --env-file=.env.local --test tests/api/book.test.mjs).
// Создаёт пользователя e2e-n11-…@example.com; в конце удаляет его вместе с проектами, фото и заказами. Журнал не трогает.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { BASE, Client, createTestUser, deleteTestUser, supabaseAdmin } from "../helpers/client.mjs";

const admin = supabaseAdmin();
const RUN = `e2e-n11-${randomUUID().slice(0, 8)}`;
const guest = new Client("гость");
const JPEG = readFileSync(new URL("../../public/demo-gallery/nesvizh-small.jpg", import.meta.url));
const recipient = { name: "Тест Тестович", phone: "+375 29 000-00-00" };
const delivery = { code: "europost", address: { pickup_point: "Минск, пункт 1" } };

let U;

before(async () => {
  const open = await guest.req("/api/v1/catalog");
  assert.equal(open.status, 200, `Сервер ${BASE} не отвечает (код ${open.status}). Запустите сервер.`);
  U = await createTestUser(admin, ["client"], "n11");
});

after(async () => {
  await admin.from("orders").delete().like("idempotency_key", `${RUN}%`);
  await deleteTestUser(admin, U);
});

async function bookProject(book) {
  const p = await U.client.req("/api/v1/projects", { method: "POST", body: { productSlug: "layflat", title: "N11", options: { size: "20x20", pages: 20, settings: { quantity: 1, book } } } });
  assert.equal(p.status, 201, p.text);
  const u = await U.client.req(`/api/v1/projects/${p.json.project.id}/photos/upload-url`, { method: "POST", body: { mime: "image/jpeg", bytes: JPEG.length } });
  assert.equal(u.status, 200, u.text);
  const put = await fetch(u.json.upload.url, { method: "PUT", headers: u.json.upload.headers, body: JPEG });
  assert.ok(put.ok, `загрузка в хранилище: ${put.status}`);
  const c = await U.client.req(`/api/v1/projects/${p.json.project.id}/photos`, { method: "POST", body: { path: u.json.upload.path } });
  assert.equal(c.status, 201, c.text);
  return p.json.project;
}

test("шаблон и обложка: сохраняются в проекте (PATCH с версией) и попадают в заказ — options и снимок для производства", async () => {
  const autumn = await bookProject({ template: "classic", cover: { title: "", date: "", layout: "photo" } });
  // клиент выбрал «Осень» и обложку — как это отправляет приложение (lib/sync.js → PATCH options)
  const book = { template: "autumn", cover: { title: "Осень у бабушки", date: "октябрь 2026", layout: "full" } };
  const patch = await U.client.req(`/api/v1/projects/${autumn.id}`, { method: "PATCH", body: { version: autumn.version, options: { size: "20x20", pages: 20, settings: { quantity: 1, acks: {}, placement: {}, book } } } });
  assert.equal(patch.status, 200, patch.text);
  // другое устройство читает проект из аккаунта — тот же выбор
  const again = await U.client.req(`/api/v1/projects/${autumn.id}`);
  assert.equal(again.status, 200, again.text);
  assert.deepEqual(again.json.project.options.settings.book, book);

  // мусор в настройках (старое приложение, ручной запрос) — в снимок заказа не проходит
  const junk = await bookProject({ template: "<img src=x>", cover: { title: "x".repeat(300), date: 42, layout: "zzz" } });

  const cart = await U.client.req("/api/v1/cart", {
    method: "PUT",
    body: {
      items: [
        { projectId: autumn.id, quantity: 1 },
        { projectId: junk.id, quantity: 1 },
      ],
    },
  });
  assert.equal(cart.status, 200, cart.text);
  const o = await U.client.req("/api/v1/orders", { method: "POST", headers: { "idempotency-key": `${RUN}-a` }, body: { delivery, recipient } });
  assert.equal(o.status, 201, o.text);
  const items = o.json.order.items;
  assert.equal(items.length, 2);
  const a = items.find((i) => i.projectId === autumn.id || i.project_id === autumn.id) || items[0];
  const j = items.find((i) => i !== a);

  assert.deepEqual(a.options.settings.book, book, "выбор клиента — в опциях позиции заказа");
  assert.deepEqual(a.snapshot.book, {
    template: "autumn",
    templateName: "Осень",
    margin: 0.1,
    gap: 0.035,
    cover: { title: "Осень у бабушки", date: "октябрь 2026", layout: "full", layoutName: "Фото на всю обложку" },
  });
  assert.equal(a.snapshot.photos.length, 1, "снимок фото на месте");

  assert.equal(j.snapshot.book.template, "classic");
  assert.equal(j.snapshot.book.cover.layout, "photo");
  assert.equal(j.snapshot.book.cover.date, "");
  assert.equal(Array.from(j.snapshot.book.cover.title).length, 40);

  // заказ из списка «Мои заказы» → та же позиция со снимком
  const full = await U.client.req(`/api/v1/orders/${o.json.order.id}`);
  assert.equal(full.status, 200, full.text);
  assert.ok(full.json.order.items.some((i) => i.snapshot?.book?.template === "autumn"));
});
