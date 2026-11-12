// rubert-tiny в node (для unit-теста и scripts/gen-intents.mjs): onnxruntime-web (wasm) — тот же движок, что в браузере
// (onnxruntime-node на Mac с Intel не ставится), токенизатор — @huggingface/tokenizers. Файлы — из public/models.
import { readFileSync } from "node:fs";

export async function loadMeaningNode() {
  const ort = await import("onnxruntime-web");
  ort.env.wasm.numThreads = 1;
  const { Tokenizer } = await import("@huggingface/tokenizers");
  const dir = new URL("../../public/models/rubert-tiny/", import.meta.url);
  const tokenizer = new Tokenizer(JSON.parse(readFileSync(new URL("tokenizer.json", dir), "utf8")), JSON.parse(readFileSync(new URL("tokenizer_config.json", dir), "utf8")));
  const session = await ort.InferenceSession.create(readFileSync(new URL("onnx/model_quantized.onnx", dir)));
  return { ort, session, tokenizer };
}
