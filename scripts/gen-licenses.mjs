#!/usr/bin/env node
// Печатает в markdown таблицу лицензий npm-зависимостей picpac-app (ОТ-08, SEC-24).
//
// Запуск (из любой папки):
//   node gen-licenses.mjs [путь-к-picpac-app] > licenses-npm.md
// Без аргумента: если скрипт лежит в picpac-app/scripts/ — берётся этот проект;
// если в docs/night/drafts/ рабочей папки хакатона — соседняя папка picpac-app.
// При переносе в репозиторий можно добавить в package.json: "licenses": "node scripts/gen-licenses.mjs > docs/licenses-npm.md"
//
// Что делает:
//   1) читает package.json проекта: dependencies и devDependencies (только прямые);
//   2) для каждого пакета открывает node_modules/<имя>/package.json и берёт установленную версию и лицензию;
//   3) помечает «⚠️» всё, что не MIT / Apache-2.0 / ISC / BSD / MPL-2.0 / OFL;
//   4) отдельной сводкой считает лицензии всех установленных пакетов по package-lock.json (в том числе транзитивных)
//      и перечисляет те, что вне списка.
// Только читает файлы. Ничего не запускает из node_modules, секретов не касается.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [process.argv[2], join(here, ".."), join(here, "..", "..", "..", "picpac-app")].filter(Boolean).map((p) => resolve(p));
const root = candidates.find((p) => existsSync(join(p, "package.json"))) || candidates[0];

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

// Разрешённые без оговорок (по списку из задания S11)
function isAllowedToken(raw) {
  const t = String(raw).trim();
  if (!t) return false;
  if (/^(MIT|ISC|MPL-2\.0|OFL-1\.1|0BSD)$/i.test(t)) return true;
  if (/^MIT[-\s]/i.test(t)) return true; // MIT-0 и т. п.
  if (/^BSD/i.test(t)) return true;
  if (/^Apache([-\s]?(License)?[-\s]?)?(Version\s)?2(\.0)?$/i.test(t)) return true;
  return false;
}

// SPDX-выражение: «A OR B» — достаточно одной разрешённой; «A AND B» — нужны все
function isAllowed(expr) {
  const s = String(expr || "").replace(/[()]/g, " ");
  if (!s.trim()) return false;
  const parts = s.split(/\s+(?:AND|OR|WITH)\s+/i);
  if (/\sAND\s/i.test(s)) return parts.every(isAllowedToken);
  return parts.some(isAllowedToken);
}

function normalize(pkg) {
  if (!pkg) return "";
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license === "object" && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(" OR ");
  return "";
}

// Пояснения для известных случаев вне списка (см. лицензии в самих пакетах и разделы «Исключения» в docs/licenses.md)
const NOTES = [
  [/^Unlicense$/i, "Unlicense — передача в общественное достояние; совместима с проектом (postgres нужен только скрипту миграций)"],
  [/^CC0/i, "CC0 — общественное достояние; совместима"],
  [/^CC-BY-4\.0$/i, "CC BY 4.0 — нужна атрибуция (указана здесь); данные о браузерах для сборки (нужны Next и browserslist), в браузер пользователя не отправляются"],
  [/^LGPL/i, "LGPL-3.0 — библиотека libvips внутри sharp (необязательная зависимость Next и @huggingface/transformers), отдельный бинарный файл на сервере; в .next/static не найдена (проверено поиском)"],
  [/^(A?GPL)/i, "GPL/AGPL — НЕ допускается: заменить пакет"],
  [/^BlueOak/i, "Blue Oak Model License — разрешительная, совместима (проверка кода eslint)"],
  [/^Python-2\.0$/i, "Python-2.0 — разрешительная, совместима (argparse у js-yaml, инструменты разработки)"],
];
const noteFor = (license) => NOTES.find(([re]) => re.test(String(license).split(/\s+(?:AND|OR)\s+/i).find((x) => !isAllowedToken(x)) || ""))?.[1] || "";

const rootPkg = readJson(join(root, "package.json"));
if (!rootPkg) {
  console.error(`Не найден package.json в ${root}`);
  process.exit(1);
}

function row(name, kind) {
  const p = readJson(join(root, "node_modules", name, "package.json"));
  if (!p) return { name, version: "не установлен", license: "—", kind, flag: "⚠️", note: "пакет не найден в node_modules — выполнить npm install" };
  let license = normalize(p);
  let note = "";
  if (!license) {
    license = "не указана в package.json";
    note = "смотреть файл LICENSE пакета вручную";
  }
  const ok = license && !license.startsWith("не указана") && isAllowed(license);
  return { name, version: p.version || "?", license, kind, flag: ok ? "" : "⚠️", note: ok ? "" : note || noteFor(license) };
}

const direct = [
  ...Object.keys(rootPkg.dependencies || {}).sort().map((n) => row(n, "рабочая")),
  ...Object.keys(rootPkg.devDependencies || {}).sort().map((n) => row(n, "разработка")),
];

const esc = (s) => String(s).replace(/\|/g, "\\|");
const out = [];
out.push("# Лицензии npm-зависимостей (сгенерировано)");
out.push("");
out.push(`Источник: \`package.json\` и \`node_modules/*/package.json\` проекта picpac-app (${rootPkg.name} ${rootPkg.version}).`);
out.push(`Собрано: ${new Date().toISOString()} (скрипт \`gen-licenses.mjs\`).`);
out.push("");
out.push("## Прямые зависимости");
out.push("");
out.push("| Пакет | Версия | Лицензия | Тип | Отметка |");
out.push("|---|---|---|---|---|");
for (const r of direct) {
  out.push(`| ${esc(r.name)} | ${esc(r.version)} | ${esc(r.license)} | ${r.kind} | ${r.flag}${r.note ? " " + esc(r.note) : ""} |`);
}
const flagged = direct.filter((r) => r.flag);
out.push("");
out.push(`Всего прямых: ${direct.length}. Вне списка (MIT, Apache-2.0, ISC, BSD, MPL-2.0, OFL): ${flagged.length}${flagged.length ? " — " + flagged.map((r) => `${r.name} (${r.license})`).join(", ") : ""}.`);

// Все установленные пакеты по package-lock.json
const lock = readJson(join(root, "package-lock.json"));
if (lock?.packages) {
  const counts = new Map();
  const odd = [];
  let total = 0;
  for (const [key, p] of Object.entries(lock.packages)) {
    if (!key.startsWith("node_modules/")) continue;
    total++;
    const name = key.replace(/^.*node_modules\//, "");
    const license = normalize(p) || "не указана";
    counts.set(license, (counts.get(license) || 0) + 1);
    if (!isAllowed(license)) {
      const flags = [p.dev ? "разработка" : "рабочая", p.optional ? "необязательная" : "", p.peer ? "peer" : ""].filter(Boolean).join(", ");
      odd.push({ name, version: p.version || "?", license, flags });
    }
  }
  out.push("");
  out.push("## Все установленные пакеты (с вложенными), по `package-lock.json`");
  out.push("");
  out.push(`Всего записей: ${total}.`);
  out.push("");
  out.push("| Лицензия | Пакетов |");
  out.push("|---|---:|");
  for (const [lic, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) out.push(`| ${esc(lic)} | ${n} |`);
  out.push("");
  out.push(`### Вне списка (${odd.length})`);
  out.push("");
  if (odd.length) {
    // Сборки sharp под разные платформы (darwin, linux, win32…) сворачиваем в одну строку
    const groups = new Map();
    for (const o of odd) {
      const prefix = o.name.replace(/-(darwin|linux|linuxmusl|win32|wasm32)(-[a-z0-9]+)?$/, "");
      const key = `${prefix}|${o.license}|${o.flags}`;
      const g = groups.get(key) || { prefix, license: o.license, flags: o.flags, items: [] };
      g.items.push(o);
      groups.set(key, g);
    }
    out.push("| Пакет | Версия | Лицензия | Где | Пояснение |");
    out.push("|---|---|---|---|---|");
    for (const g of [...groups.values()].sort((a, b) => a.prefix.localeCompare(b.prefix))) {
      const one = g.items.length === 1;
      const name = one ? g.items[0].name : `${g.prefix}-* (сборок под платформы: ${g.items.length})`;
      const versions = [...new Set(g.items.map((i) => i.version))].join(", ");
      out.push(`| ${esc(name)} | ${esc(versions)} | ${esc(g.license)} | ${g.flags} | ${esc(noteFor(g.license))} |`);
    }
  } else {
    out.push("Нет.");
  }
} else {
  out.push("");
  out.push("`package-lock.json` не найден — сводка по вложенным пакетам не собрана.");
}

console.log(out.join("\n"));
