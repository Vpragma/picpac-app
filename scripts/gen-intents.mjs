// Векторы примеров смыслов (N3, SHOULD): lib/photo/intents.js → public/models/rubert-tiny/intents.json.
// Считает та же модель, что работает в браузере (rubert-tiny int8 из public/models, onnxruntime-web в node).
// Запуск: node scripts/gen-intents.mjs (после правки примеров в lib/photo/intents.js)
import { readFileSync, writeFileSync } from "node:fs";
import { INTENTS } from "../lib/photo/intents.js";
import { embedText, packVec } from "../lib/photo/meaning.js";
import { loadMeaningNode } from "../tests/helpers/meaning-node.mjs";

const rt = await loadMeaningNode();
const out = { v: 1, model: "onnx-community/rubert-tiny-ONNX (int8, + выход [CLS])", intents: {} };
for (const it of INTENTS) {
  out.intents[it.id] = [];
  for (const a of [it.label, ...it.anchors]) out.intents[it.id].push(packVec(await embedText(rt, a)));
}
const file = new URL("../public/models/rubert-tiny/intents.json", import.meta.url);
writeFileSync(file, JSON.stringify(out));
console.log("intents.json:", Object.keys(out.intents).length, "смыслов,", readFileSync(file).length, "байт");
