// lib/me.js: «гость» — только по ответу сервера; сбой GET /me — «пока неизвестно» с повтором (критик S02, круг 2)
import { test } from "node:test";
import assert from "node:assert/strict";
import { meFromResponse, retryDelay, getMe, isClient, onMeChange } from "../../lib/me.js";

test("me: 200 — как ответил сервер (клиент или гость)", () => {
  const client = { status: 200, authenticated: true, activeRole: "client", user: { id: "u1" } };
  assert.equal(meFromResponse(client), client);
  assert.deepEqual(meFromResponse({ status: 200, authenticated: false }), { status: 200, authenticated: false });
});

test("me: 401 — гость; 5xx, 429, нет сети — неизвестно (не гость)", () => {
  assert.deepEqual(meFromResponse({ status: 401, ok: false }), { authenticated: false });
  for (const status of [500, 502, 503, 429]) {
    const m = meFromResponse({ status, ok: false });
    assert.equal(m.unknown, true, `status ${status}`);
    assert.equal(m.offline, false);
  }
  assert.deepEqual(meFromResponse({ status: 0, ok: false }), { authenticated: false, unknown: true, offline: true });
});

test("me: отсрочка повтора 1, 2, 4… до 30 с", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test("me: после сбоя /me следующий запрос спрашивает сервер снова, подписчики узнают о входе", async () => {
  const answers = [{ status: 503, body: { ok: false } }, { status: 200, body: { authenticated: true, activeRole: "client", user: { id: "u1" } } }];
  let calls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const a = answers[Math.min(calls++, answers.length - 1)];
    return { status: a.status, json: async () => a.body };
  };
  try {
    const seen = [];
    const off = onMeChange((m) => seen.push(m));
    const first = await getMe();
    assert.equal(first.unknown, true);
    assert.equal(isClient(first), false);
    const second = await getMe(); // кэш «неизвестно» не держит — снова к серверу
    assert.equal(isClient(second), true);
    assert.equal(calls, 2);
    assert.equal(await getMe(), second); // известный ответ кэшируется
    assert.equal(calls, 2);
    assert.ok(seen.some((m) => m.unknown) && isClient(seen.at(-1)));
    off();
  } finally {
    globalThis.fetch = realFetch;
  }
});
