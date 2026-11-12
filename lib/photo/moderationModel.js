// Модерация фото (N4): общее ядро для воркера на устройстве и проверки на сервере — подготовка пикселей и подсчёт оценок.
// Две модели (обе из public/models, без сторонних хостов):
//   • классификатор обнажённости Marqo/nsfw-image-detection-384 (ViT-tiny, Apache-2.0): вход 384×384 «как есть»
//     (без сохранения пропорций), (x/255 − 0,5)/0,5, выход logits [nsfw, safe];
//   • CLIP ViT-B/32 (MIT), визуальный энкодер int8: вход 224×224 (короткая сторона → 224, центр), нормировка CLIP,
//     выход image_embeds → косинус с готовыми текстовыми эмбеддингами классов (clip-text.json) → softmax.
// Ресайз делает вызывающий код (OffscreenCanvas на устройстве, sharp на сервере). Здесь — только числа.
export const MODEL_DIR = "/models/moderation";
export const NSFW_MODEL = { path: `${MODEL_DIR}/nsfw-384.onnx`, size: 22450633, sha256: "e9350e576608afe4b57a089ffeb0ebafa1389cdcea4882dd61df28c45f1c24d2" };
export const CLIP_MODEL = { path: `${MODEL_DIR}/clip-vision-b32-int8.onnx`, size: 89117001, sha256: "583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299" };
export const CLIP_TEXT = { path: `${MODEL_DIR}/clip-text.json`, size: null };
export const NSFW_SIZE = 384;
export const CLIP_SIZE = 224;
// Версия оценок: меняется вместе с моделями, порогами разбора и списком классов
export const SCORES_VERSION = 2;

const CLIP_MEAN = [0.48145466, 0.4578275, 0.40821073];
const CLIP_STD = [0.26862954, 0.26130258, 0.27577711];

// px — RGBA (канвас) или RGB (sharp) квадрат size×size → Float32Array [1, 3, size, size]
function toTensorData(px, size, channels, f) {
  const n = size * size;
  const out = new Float32Array(3 * n);
  for (let i = 0, j = 0; i < n; i++, j += channels) {
    out[i] = f(px[j], 0);
    out[n + i] = f(px[j + 1], 1);
    out[2 * n + i] = f(px[j + 2], 2);
  }
  return out;
}

export const nsfwInput = (px, channels = 4) => toTensorData(px, NSFW_SIZE, channels, (v) => v / 127.5 - 1);
export const clipInput = (px, channels = 4) => toTensorData(px, CLIP_SIZE, channels, (v, c) => (v / 255 - CLIP_MEAN[c]) / CLIP_STD[c]);

// Вероятность «nsfw» из logits [nsfw, safe]
export function nsfwProb(logits) {
  const m = Math.max(logits[0], logits[1]);
  const a = Math.exp(logits[0] - m);
  const b = Math.exp(logits[1] - m);
  return a / (a + b);
}

// Вероятности категорий по эмбеддингу кадра: softmax(scale · cos) по всем классам, сумма по категории.
// text = { scale, classes: [{ id, cat, emb }] }. Ответ: { breast, nude, sex, nazi, weapon, blood, drugs, art }
export function clipCategories(imageEmb, text) {
  let norm = 0;
  for (let i = 0; i < imageEmb.length; i++) norm += imageEmb[i] * imageEmb[i];
  norm = Math.sqrt(norm) || 1;
  const logits = text.classes.map((c) => {
    let s = 0;
    for (let i = 0; i < c.emb.length; i++) s += c.emb[i] * imageEmb[i];
    return (text.scale || 100) * (s / norm);
  });
  const m = Math.max(...logits);
  const ex = logits.map((l) => Math.exp(l - m));
  const sum = ex.reduce((a, b) => a + b, 0);
  const cats = { breast: 0, nude: 0, sex: 0, nazi: 0, weapon: 0, blood: 0, drugs: 0, art: 0 };
  text.classes.forEach((c, i) => {
    if (c.cat && c.cat in cats) cats[c.cat] += ex[i] / sum;
  });
  return cats;
}

const r4 = (v) => Math.round(v * 10000) / 10000;

// Итоговые оценки фото (их отправляет устройство и сохраняет сервер): числа 0…1, без разбора — разбор в lib/moderation.js
export function moderationScores(nsfw, cats) {
  const out = { v: SCORES_VERSION, nsfw: r4(nsfw) };
  for (const [k, v] of Object.entries(cats || {})) out[k] = r4(v);
  return out;
}
