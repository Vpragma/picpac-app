// N2 · договор сезонов (docs/night/night2-seasons.md): значения, палитры, пары текста с контрастом AA,
// совпадение палитр в коде (lib/seasonShared.js), стилях (app/season.css) и ограничении базы (миграция 0014).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contrastRatio, parseSeason, SEASON_LABELS, SEASON_LOGO, SEASON_PALETTES, SEASONS } from "../../lib/seasonShared.js";

// Таблица договора — как в документе, слово в слово
const CONTRACT = {
  autumn: { bg: "#F6EBDD", ink: "#3A2A22", 1: "#C98A2E", 2: "#B95C3A", 3: "#7A2833", 4: "#2F4A3F", 5: "#E2A84B" },
  blackfriday: { bg: "#1C1F1E", ink: "#F6EFE6", 1: "#DD5757", 2: "#E8996C", 3: "#AEB4B3", 4: "#FFFFFF", 5: "#38524F" },
  newyear: { bg: "#24443B", ink: "#FFFFFF", 1: "#D6A84A", 2: "#CFDDE7", 3: "#BD3434", 4: "#FAF7F7", 5: "#7AA45A" },
};

test("сезоны: ровно none / autumn / blackfriday / newyear, подписи по-русски", () => {
  assert.deepEqual(SEASONS, ["none", "autumn", "blackfriday", "newyear"]);
  assert.deepEqual(SEASON_LABELS, { none: "Без сезона", autumn: "Осень", blackfriday: "Чёрная пятница", newyear: "Новый год" });
});

test("parseSeason: неизвестное, пустое и чужое — «none» (нет ответа — сезонных элементов нет)", () => {
  for (const s of SEASONS) assert.equal(parseSeason(s), s);
  for (const bad of [undefined, null, "", "AUTUMN", "spring", "autumn ", 1, {}]) assert.equal(parseSeason(bad), "none");
});

test("палитры совпадают с таблицей договора", () => {
  assert.deepEqual(SEASON_PALETTES, CONTRACT);
});

test("текст на сезонных элементах — только пары с контрастом AA (≥ 4.5:1)", () => {
  for (const [s, p] of Object.entries(SEASON_PALETTES)) {
    const r = contrastRatio(p.ink, p.bg);
    assert.ok(r >= 4.5, `${s}: --season-ink на --season-bg = ${r.toFixed(2)}`);
  }
  for (const bg of ["#7A2833", "#2F4A3F", "#24443B"]) assert.ok(contrastRatio("#FFFFFF", bg) >= 4.5, `белый на ${bg}`);
  // проверка самой формулы: чёрный на белом — 21:1
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
});

test("логотип сезона заметен на шапке (≥ 3:1 к фону светлой и тёмной темы)", () => {
  for (const [s, c] of Object.entries(SEASON_LOGO)) {
    assert.ok(contrastRatio(c.light, "#faf5ed") >= 3, `${s}: светлая шапка`);
    assert.ok(contrastRatio(c.dark, "#172321") >= 3, `${s}: тёмная шапка`);
  }
});

test("app/season.css: те же цвета у каждого сезона; кнопки, текст и фон интерфейса не переопределяются", () => {
  const css = readFileSync(new URL("../../app/season.css", import.meta.url), "utf8").toLowerCase();
  for (const [s, p] of Object.entries(CONTRACT)) {
    const block = css.slice(css.indexOf(`:root[data-season='${s}'],\n.season-palette-${s} {`));
    const body = block.slice(0, block.indexOf("}"));
    assert.ok(body.length > 20, `блок палитры ${s}`);
    assert.match(body, new RegExp(`--season-bg: ${p.bg.toLowerCase()}`));
    assert.match(body, new RegExp(`--season-ink: ${p.ink.toLowerCase()}`));
    for (const k of [1, 2, 3, 4, 5]) assert.match(body, new RegExp(`--season-${k}: ${p[k].toLowerCase()}`), `${s} --season-${k}`);
  }
  // сезон не трогает фирменные токены (--ds-*) — меняются только сезонные элементы
  assert.doesNotMatch(css, /--ds-[a-z-]+\s*:/);
});

test("миграция 0014: в базе допустимы те же значения, по умолчанию — «none», менять может только сервер", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/0014_season.sql", import.meta.url), "utf8");
  assert.match(sql, /check \(season in \('none', 'autumn', 'blackfriday', 'newyear'\)\)/);
  assert.match(sql, /season text not null default 'none'/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /grant select on public\.site_season to anon, authenticated/);
  assert.doesNotMatch(sql, /grant (insert|update|delete)[^;]*to (anon|authenticated)/);
  assert.doesNotMatch(sql, /\bdrop table\b|\bdrop column\b|\balter table [^;]* drop\b/i);
});

test("пуш: иконка в цветах сезона — только свои файлы /icons/season/, без сезона — обычная иконка", async () => {
  const { pushPayload, seasonIcon } = await import("../../lib/notifyRules.js");
  const { existsSync } = await import("node:fs");
  for (const s of ["autumn", "blackfriday", "newyear"]) {
    const icon = seasonIcon(s);
    assert.equal(icon, `/icons/season/icon-${s}-192.png`);
    assert.ok(existsSync(new URL(`../../public${icon}`, import.meta.url)), `файл ${icon}`);
    assert.equal(JSON.parse(pushPayload({ title: "t", icon })).icon, icon);
  }
  assert.equal(seasonIcon("none"), undefined);
  assert.equal(JSON.parse(pushPayload({ title: "t" })).icon, undefined);
  for (const bad of ["https://evil.com/x.png", "/icons/icon-192.png", "/icons/season/icon-spring-192.png", "//evil.com/icons/season/icon-autumn-192.png"]) {
    assert.equal(JSON.parse(pushPayload({ title: "t", icon: bad })).icon, undefined, bad);
  }
  const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /icons\\\/season\\\/icon-\(autumn\|blackfriday\|newyear\)-192/);
});
