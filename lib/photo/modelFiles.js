// Файлы моделей ИИ-редактора и их размер в байтах (как на диске в public/). Размер нужен для честного процента
// загрузки: Vercel отдаёт .onnx и .wasm сжатыми (br) без Content-Length, поэтому считаем прочитанные байты
// и делим на размер отсюда. Unit-тест сверяет размеры с файлами — при замене модели тест подскажет обновить.
export const ORT_WASM = { url: "/ort/ort-wasm-simd-threaded.wasm", size: 14848852 };
export const ORT_MJS = "/ort/ort-wasm-simd-threaded.mjs";

export const SAM_MODEL = "slimsam-77-uniform-boxes";
export const SAM_FILES = [
  { url: "/models/slimsam-77-uniform-boxes/config.json", size: 379 },
  { url: "/models/slimsam-77-uniform-boxes/preprocessor_config.json", size: 466 },
  { url: "/models/slimsam-77-uniform-boxes/onnx/vision_encoder_quantized.onnx", size: 8882165 },
  { url: "/models/slimsam-77-uniform-boxes/onnx/prompt_encoder_mask_decoder_quantized.onnx", size: 4751034 },
];

export const MIGAN_FILE = { url: "/models/migan/migan_pipeline_v2.onnx", size: 28079181 };

// N3: поиск предмета словом — YOLOX-Nano (Apache-2.0, релиз Megvii 0.1.1rc0), 3,7 МБ
export const YOLOX_FILE = { url: "/models/yolox-nano/yolox_nano.onnx", size: 3659407 };

// Сколько мегабайт качать в первый раз (для подписи «один раз, около N МБ»)
export const mb = (files) => Math.round(files.reduce((s, f) => s + f.size, 0) / 1e6);
