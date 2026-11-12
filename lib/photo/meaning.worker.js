// Воркер «по смыслу» (N3, SHOULD): фраза, которую не понял словарь → ближайшие команды редактора.
// rubert-tiny (MIT, int8 12 МБ) и словарь токенов — с нашего сайта (public/models/rubert-tiny), onnxruntime-web —
// из public/ort (тот же wasm, что у выделения; сервис-воркер кэширует — дальше работает без интернета).
// Создаётся только когда словарь не понял фразу; текст фразы никуда не уходит — всё в этом воркере.
import { Tokenizer } from "@huggingface/tokenizers";
import { fetchAll } from "./fetchBytes.js";
import { decide, embedText, loadTable, rankIntents } from "./meaning.js";
import { MEANING_FILES, ORT_WASM } from "./modelFiles.js";
import { needsWasm, ort, setupOrt, setWasmBinary } from "./ort.js";

let rtP = null;
const send = (msg) => self.postMessage(msg);

function load(id) {
  setupOrt();
  rtP ??= (async () => {
    const files = [...(needsWasm() ? [ORT_WASM] : []), ...MEANING_FILES];
    const bytes = await fetchAll(files, (p) => send({ id, type: "progress", stage: "load", p }));
    if (bytes.has(ORT_WASM.url)) setWasmBinary(bytes.get(ORT_WASM.url));
    const text = (url) => new TextDecoder().decode(bytes.get(url));
    const [model, tok, tokCfg, intents] = MEANING_FILES.map((f) => f.url);
    const tokenizer = new Tokenizer(JSON.parse(text(tok)), JSON.parse(text(tokCfg)));
    const session = await ort.InferenceSession.create(bytes.get(model), { executionProviders: ["wasm"] });
    return { ort, session, tokenizer, table: loadTable(JSON.parse(text(intents))) };
  })().catch((e) => {
    rtP = null;
    throw e;
  });
  return rtP;
}

self.onmessage = async (e) => {
  const { id, type, text } = e.data || {};
  try {
    if (type === "ping") return send({ id, ok: true }); // «Скачать ИИ заранее»: код воркера уже загружен
    if (type !== "rank") throw new Error("unknown");
    const rt = await load(id);
    const ranked = rankIntents(await embedText(rt, text), rt.table);
    const { pick, options } = decide(ranked);
    send({ id, ok: true, pick, options, top: ranked.slice(0, 3) });
  } catch (err) {
    console.error("Воркер смысла:", err);
    send({ id, ok: false, error: String(err?.message || err) });
  }
};
