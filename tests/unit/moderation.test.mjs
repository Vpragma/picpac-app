// N4: разбор оценок моделей модерации в слова и пороги флага (lib/moderation.js), ядро моделей (lib/photo/moderationModel.js).
// Пороги сверяются с оценками тестового набора (tests/fixtures/moderation-scores.json — только числа, без фото).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const M = await import("../../lib/moderation.js");
const core = await import("../../lib/photo/moderationModel.js");
const clean = { v: 2, nsfw: 0.05, breast: 0.01, nude: 0.01, sex: 0, nazi: 0.01, weapon: 0.01, blood: 0.01, drugs: 0.01, art: 0.02 };

test("N4: обычное фото — ни одной находки, без флага", () => {
  assert.deepEqual(M.findings(clean), []);
  assert.equal(M.needsModeration(clean), false);
  assert.equal(M.needsModeration(null), false);
  assert.equal(M.needsModeration({ v: 2 }), false, "пустые оценки — не флаг");
  assert.equal(M.needsModeration({ v: 2, nsfw: NaN, nazi: "x" }), false, "мусор — не флаг");
});

test("N4: обнажённая грудь — «Найдено: обнажённая грудь (высокая уверенность)»", () => {
  const f = M.findings({ ...clean, nsfw: 0.92, breast: 0.7, nude: 0.1 });
  assert.deepEqual(f, [{ id: "breast", level: "high" }]);
  assert.equal(M.describeFinding(f[0]), "Найдено: обнажённая грудь (высокая уверенность)");
  // Только классификатор, CLIP не уточнил — общее слово
  assert.deepEqual(M.findings({ ...clean, nsfw: 0.8 }), [{ id: "nudity", level: "high" }]);
  // Средний уровень классификатора — «Возможно»
  assert.deepEqual(M.findings({ ...clean, nsfw: 0.5 }), [{ id: "nudity", level: "medium" }]);
  // Средний классификатор + средний CLIP — вместе «высокая»
  assert.equal(M.findings({ ...clean, nsfw: 0.5, breast: 0.35 })[0].level, "high");
  // Только CLIP (классификатор промолчал) — тоже находка
  assert.deepEqual(M.findings({ ...clean, nsfw: 0.1, nude: 0.32 }), [{ id: "nude", level: "medium" }]);
});

test("N4: статуя в музее — один классификатор без CLIP флаг не ставит, живое тело — ставит", () => {
  assert.deepEqual(M.findings({ ...clean, nsfw: 0.88, art: 0.95 }), [], "Давид в музее");
  assert.equal(M.findings({ ...clean, nsfw: 0.88, art: 0.95, nude: 0.4 })[0].id, "nude", "CLIP видит обнажённое тело — флаг");
  assert.equal(M.findings({ ...clean, nsfw: 0.88, art: 0.3 })[0].id, "nudity", "не искусство — флаг");
  // Однотонный бежевый кадр: классификатор путает цвет кожи с телом — CLIP видит «пустой кадр»
  assert.deepEqual(M.findings({ ...clean, nsfw: 0.5, plain: 0.95 }), [], "пустой кадр");
});

test("N4: символика, оружие, кровь, наркотики — уровни и слова", () => {
  assert.deepEqual(M.findings({ ...clean, nazi: 0.45 }), [{ id: "nazi", level: "medium" }]);
  assert.equal(M.describeFinding({ id: "nazi", level: "medium" }), "Возможно: нацистская символика (средняя уверенность)");
  assert.deepEqual(M.findings({ ...clean, weapon: 0.9 }), [{ id: "weapon", level: "high" }]);
  assert.deepEqual(M.findings({ ...clean, drugs: 0.36, blood: 0.8 }), [
    { id: "blood", level: "high" },
    { id: "drugs", level: "medium" },
  ]);
  // Граница: ровно порог — уже находка, чуть ниже — нет
  assert.equal(M.findings({ ...clean, nazi: M.THRESHOLDS.nazi.medium }).length, 1);
  assert.equal(M.findings({ ...clean, nazi: M.THRESHOLDS.nazi.medium - 0.001 }).length, 0);
});

test("N4: служебные находки — демо, не проверено, старые оценки nsfwjs по прежним порогам", () => {
  assert.equal(M.describeFinding(M.findings({ v: 2, demo: 1 })[0]), "Демо: фото помечено вручную для показа модерации");
  assert.equal(M.findings({ unchecked: true })[0].id, "unchecked");
  assert.deepEqual(M.findings({ porn: 0.6, hentai: 0.1001, sexy: 0 }), [{ id: "explicit", level: "high" }]);
  assert.deepEqual(M.findings({ porn: 0, hentai: 0, sexy: 0.86 }), [{ id: "suggestive", level: "medium" }]);
  assert.deepEqual(M.findings({ porn: 0.01, hentai: 0.01, sexy: 0.05 }), [], "у собаки «sexy 5 %» — ничего");
});

test("N4: экран модератора — вердикт сервера важнее оценок устройства, «не проверено» видно", () => {
  const verdict = { v: 2, path: "a/b/c.jpg", scores: { ...clean, weapon: 0.9 } };
  assert.deepEqual(M.reviewFindings({ verdict, device: { ...clean, nazi: 0.5 } }), { source: "server", list: [{ id: "weapon", level: "high" }] });
  assert.deepEqual(M.reviewFindings({ verdict: { v: 2, scores: clean }, device: { v: 2, demo: 1 } }).list, [{ id: "demo", level: "medium" }]);
  assert.equal(M.reviewFindings({ verdict: { unchecked: true }, device: null }).list[0].id, "unchecked");
  assert.deepEqual(M.reviewFindings({}), { source: "none", list: [] });
  assert.deepEqual(M.findingCodes([{ id: "breast", level: "high" }]), ["breast:high"]);
  // Шаблоны причин: для каждой причины есть шаблон, у находок — подходящая причина из списка
  for (const k of Object.keys(M.RETURN_REASONS)) assert.equal(typeof M.RETURN_TEMPLATES[k], "string");
  for (const r of Object.values(M.REASON_FOR_FINDING)) assert.ok(M.RETURN_REASONS[r], r);
});

test("N4: ядро моделей — softmax, нормировка входа, доли категорий", () => {
  assert.ok(Math.abs(core.nsfwProb([0, 0]) - 0.5) < 1e-9);
  assert.ok(core.nsfwProb([5, -5]) > 0.99);
  const px = new Uint8Array(core.NSFW_SIZE * core.NSFW_SIZE * 4).fill(255);
  const x = core.nsfwInput(px, 4);
  assert.equal(x.length, 3 * core.NSFW_SIZE * core.NSFW_SIZE);
  assert.equal(x[0], 1);
  const cpx = new Uint8Array(core.CLIP_SIZE * core.CLIP_SIZE * 3).fill(0);
  assert.ok(core.clipInput(cpx, 3)[0] < -1.7, "чёрный после нормировки CLIP");
  const text = { scale: 100, classes: [{ id: "gun", cat: "weapon", emb: [1, 0] }, { id: "dog", cat: null, emb: [0, 1] }] };
  const cats = core.clipCategories([0.9, 0.1], text);
  assert.ok(cats.weapon > 0.99 && cats.nazi === 0);
  const s = core.moderationScores(0.123456, cats);
  assert.equal(s.v, core.SCORES_VERSION);
  assert.equal(s.nsfw, 0.1235);
});

test("N4: пороги на тестовом наборе — 0 ложных в ok/, символика, оружие и наркотики пойманы", () => {
  const { scores } = JSON.parse(readFileSync(new URL("../fixtures/moderation-scores.json", import.meta.url), "utf8"));
  const by = {};
  for (const [key, s] of Object.entries(scores)) {
    const folder = key.split("/")[0];
    (by[folder] ??= []).push([key, M.needsModeration(s)]);
  }
  const falsePos = by.ok.filter(([, f]) => f).map(([k]) => k);
  assert.deepEqual(falsePos, [], "ложные срабатывания на обычных фото");
  for (const folder of ["symbols", "weapons", "drugs"]) {
    const missed = by[folder].filter(([, f]) => !f).map(([k]) => k);
    assert.deepEqual(missed, [], `пропущено в ${folder}`);
  }
});
