// Текстовые эмбеддинги классов CLIP для модерации (N4) — считаются один раз, в работу приложения не входят.
//   node scripts/moderation-embed.mjs <папка Xenova/clip-vit-base-patch32>
// Нужны tokenizer.json, tokenizer_config.json и onnx/text_model.onnx (fp32, 254 МБ — в репозиторий не кладём,
// лежит в ~/Documents/hackathon/models-cache/n4/). Результат: public/models/moderation/clip-text.json.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-web";
import { Tokenizer } from "@huggingface/tokenizers";
import { CLIP_CLASSES } from "../lib/photo/moderationPrompts.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Укажите папку модели: node scripts/moderation-embed.mjs ~/Documents/hackathon/models-cache/n4/clip-vit-base-patch32");
  process.exit(1);
}
ort.env.wasm.numThreads = 1;
const tok = new Tokenizer(JSON.parse(readFileSync(join(dir, "tokenizer.json"), "utf8")), JSON.parse(readFileSync(join(dir, "tokenizer_config.json"), "utf8")));
const session = await ort.InferenceSession.create(readFileSync(join(dir, "onnx/text_model.onnx")));

const norm = (v) => {
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
};

const classes = [];
for (const c of CLIP_CLASSES) {
  const sum = new Array(512).fill(0);
  for (const p of c.prompts) {
    const { ids } = tok.encode(p);
    if (ids[0] !== 49406 || ids[ids.length - 1] !== 49407) throw new Error("Неожиданные токены начала/конца: " + p);
    const out = await session.run({ input_ids: new ort.Tensor("int64", BigInt64Array.from(ids.map(BigInt)), [1, ids.length]) });
    const e = norm(Array.from(out.text_embeds.data));
    for (let i = 0; i < 512; i++) sum[i] += e[i];
  }
  classes.push({ id: c.id, cat: c.cat, emb: norm(sum).map((x) => Math.round(x * 1e5) / 1e5) });
  process.stdout.write(".");
}
const outDir = join(process.cwd(), "public/models/moderation");
mkdirSync(outDir, { recursive: true });
const json = { model: "Xenova/clip-vit-base-patch32 onnx/text_model.onnx (fp32)", dim: 512, scale: 100, classes };
writeFileSync(join(outDir, "clip-text.json"), JSON.stringify(json));
console.log(`\nГотово: ${classes.length} классов → public/models/moderation/clip-text.json`);
