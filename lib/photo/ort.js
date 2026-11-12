// onnxruntime-web для воркеров ИИ-редактора: один экземпляр (next.config.mjs → turbopack.resolveAlias),
// wasm и фабрика .mjs — с нашего сайта (public/ort), без CDN; работает со строгой CSP.
// Сам .wasm (14,8 МБ) воркер скачивает заранее с процентом (lib/photo/fetchBytes.js) и отдаёт ORT готовым
// (env.wasm.wasmBinary) — так загрузка видна пользователю, а ORT не качает его второй раз.
import * as ort from "onnxruntime-web/webgpu";
import { ORT_MJS, ORT_WASM } from "./modelFiles.js";

let configured = false;
let wasmReady = false;

export function setupOrt() {
  if (!configured) {
    ort.env.wasm.wasmPaths = { mjs: ORT_MJS, wasm: ORT_WASM.url };
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    configured = true;
  }
  return ort;
}

// Нужно ли ещё скачать wasm в этом воркере
export const needsWasm = () => !wasmReady;

export function setWasmBinary(bytes) {
  setupOrt();
  if (wasmReady || !bytes) return;
  ort.env.wasm.wasmBinary = bytes;
  wasmReady = true;
}

export { ort };
