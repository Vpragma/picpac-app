// Презентация (ночь 2): финальный прогон одной командой — снимки экранов, пары «было / стало», видео.
//   npm run present:all -- --base http://127.0.0.1:3000 --out ../docs/presentation/final
// Пишет: <out>/screens/, <out>/before-after/, <out>/demo-video-v2.webm (телефон), <out>/demo-video-v2-desktop.webm
// (компьютер), общий журнал <out>/_present-all.log.
// «Было» для пар берётся из <out>/_draft/before-after/before (снято заранее с основного сайта), если папка есть;
// иначе снимается заново с https://picpac-app-jade.vercel.app (только открытые экраны).
// Параметры: --only screens,before-after,video · --devices desktop,phone · --video-device phone,desktop (по умолчанию оба)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isLocal, makeLog, parseArgs, stamp, trimBase } from "./present-common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://127.0.0.1:3000", out: ".night-logs/present-final", only: "screens,before-after,video", devices: "desktop,phone", "video-device": "phone,desktop" });
const BASE = trimBase(args.base);
const OUT = path.resolve(args.out);
const ONLY = new Set(args.only.split(",").map((s) => s.trim()));
const DIR = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(OUT, { recursive: true });
const log = makeLog(path.join(OUT, "_present-all.log"));
if (!isLocal(BASE)) log("ВНИМАНИЕ: --base не локальный — экраны со входом, админка и видео будут пропущены (вход только на 127.0.0.1)");

function run(script, extra) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    log(`→ ${script} ${extra.join(" ")}`);
    const child = spawn(process.execPath, [path.join(DIR, script), ...extra], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    const tail = [];
    const keep = (d) => {
      for (const line of String(d).split("\n").filter(Boolean)) {
        tail.push(line);
        if (tail.length > 400) tail.shift();
        if (/(FAIL|ИТОГ|ВНИМАНИЕ|видео:|время прогона)/.test(line)) log("   " + line.trim());
      }
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("close", (code) => {
      log(`← ${script}: код ${code}, ${Math.round((Date.now() - t0) / 1000)} с`);
      if (code !== 0) for (const l of tail.slice(-15)) log("   | " + l);
      resolve(code);
    });
  });
}

log(`present-all: base=${BASE} out=${OUT} · ${stamp()}`);
const codes = {};
if (ONLY.has("screens")) codes.screens = await run("present-screens.mjs", ["--base", BASE, "--out", path.join(OUT, "screens"), "--devices", args.devices]);
if (ONLY.has("before-after")) {
  const draftBefore = path.join(OUT, "_draft", "before-after", "before");
  const extra = ["--base", BASE, "--out", path.join(OUT, "before-after"), "--devices", args.devices];
  if (fs.existsSync(draftBefore) && fs.readdirSync(draftBefore).some((f) => f.endsWith(".png"))) extra.push("--before-dir", draftBefore);
  codes.beforeAfter = await run("present-before-after.mjs", extra);
}
// Видео: телефон → demo-video-v2.webm, компьютер (16:9, удобно на слайд) → demo-video-v2-desktop.webm
if (ONLY.has("video") && isLocal(BASE))
  for (const dev of args["video-device"].split(",").map((s) => s.trim()).filter(Boolean)) {
    const file = dev === "desktop" ? "demo-video-v2-desktop.webm" : "demo-video-v2.webm";
    codes["video-" + dev] = await run("present-video.mjs", ["--base", BASE, "--out", path.join(OUT, file), "--device", dev]);
  }
log(`ГОТОВО: ${JSON.stringify(codes)} · всего ${Math.round(log.elapsed() / 60)} мин`);
