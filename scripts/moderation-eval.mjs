// Оценка модерации на тестовом наборе (N4): «поймано / ложные» по папкам при текущих порогах lib/moderation.js.
//   node scripts/moderation-eval.mjs [папка набора] [--list]
// Набор (вне git): ~/Documents/hackathon/moderation-test/{ok,nsfw,symbols,…}. ok/ — фото, которые НЕ должны получить
// флаг (ложные срабатывания); остальные папки, кроме edge/, — должны (поймано). edge/ — спорные, только для сведения.
// Оценки каждого фото пишутся в <набор>/scores.json — по ним подбираются пороги без повторного прогона моделей.
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { scoreImage, loadEngine } from "../lib/server/moderationEngine.js";
import { findings, describeFinding } from "../lib/moderation.js";

const args = process.argv.slice(2);
const root = args.find((a) => !a.startsWith("--")) || join(homedir(), "Documents/hackathon/moderation-test");
const list = args.includes("--list");
const cached = args.includes("--cached");
const cacheFile = join(root, "scores.json");

const t0 = Date.now();
let all = {};
if (cached && existsSync(cacheFile)) {
  all = JSON.parse(readFileSync(cacheFile, "utf8"));
} else {
  await loadEngine();
  console.log(`Модели загружены за ${Date.now() - t0} мс`);
  for (const folder of readdirSync(root).filter((f) => statSync(join(root, f)).isDirectory()).sort()) {
    for (const f of readdirSync(join(root, folder)).filter((x) => /\.(jpe?g|png)$/i.test(x)).sort()) {
      const t = Date.now();
      try {
        all[`${folder}/${f}`] = { ...(await scoreImage(readFileSync(join(root, folder, f)))), ms: Date.now() - t };
      } catch (e) {
        all[`${folder}/${f}`] = { error: String(e.message || e) };
      }
    }
  }
  writeFileSync(cacheFile, JSON.stringify(all, null, 1));
}

const byFolder = {};
const times = [];
for (const [key, s] of Object.entries(all)) {
  const folder = key.split("/")[0];
  const b = (byFolder[folder] ??= { total: 0, flagged: 0, errors: 0, names: [] });
  b.total++;
  if (s.error) {
    b.errors++;
    if (list) console.log("ОШИБКА", key, s.error);
    continue;
  }
  if (s.ms) times.push(s.ms);
  const found = findings(s);
  if (found.length) b.flagged++;
  if (list) {
    const top = Object.entries(s).filter(([k]) => !["v", "ms"].includes(k)).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${v.toFixed(3)}`).join(", ");
    console.log((found.length ? "ФЛАГ " : "  —  ") + key.padEnd(62), "|", found.map(describeFinding).join("; ") || "", "|", top);
  }
}
console.log("\nПапка       всего  с флагом  ошибок");
for (const [folder, b] of Object.entries(byFolder)) {
  const kind = folder === "ok" ? "ложные" : folder === "edge" ? "спорные" : "поймано";
  console.log(`${folder.padEnd(10)} ${String(b.total).padStart(6)} ${String(b.flagged).padStart(8)} ${String(b.errors).padStart(7)}   (${kind}: ${b.flagged} из ${b.total})`);
}
if (times.length) console.log(`\nВремя на фото: среднее ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} мс, максимум ${Math.max(...times)} мс`);
