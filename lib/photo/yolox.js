// Поиск предметов на фото (N3): YOLOX-Nano (Apache-2.0, Megvii, ONNX из релиза 0.1.1rc0) — чистые функции
// без DOM: подготовка кадра и разбор ответа. Работают в воркере выделения (lib/photo/ai.worker.js) и в unit-тестах.
//
// Вход модели: images [1, 3, 416, 416], порядок каналов BGR, значения 0…255 без нормализации, кадр вписан
// в квадрат у левого верхнего угла, остаток залит серым 114 (как preproc в YOLOX ≥ 0.1.1).
// Выход: [1, 3549, 85] — для каждой клетки сеток 52², 26², 13² (шаги 8, 16, 32): cx, cy, w, h (ещё в клетках),
// «есть предмет» (0…1), 80 вероятностей классов COCO. Оценка = «есть предмет» × класс; дальше NMS по классу.

export const YOLOX_SIZE = 416;
export const YOLOX_STRIDES = [8, 16, 32];

// 80 классов COCO в порядке YOLOX
export const COCO = [
  "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat", "traffic light",
  "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog", "horse", "sheep", "cow",
  "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
  "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
  "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
  "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch", "potted plant", "bed",
  "dining table", "toilet", "tv", "laptop", "mouse", "remote", "keyboard", "cell phone", "microwave", "oven",
  "toaster", "sink", "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
];

// RGBA кадра w×h (уже уменьшенного так, что длинная сторона ≤ size) → Float32Array CHW (BGR, 0…255) и масштаб
export function yoloxInput(rgba, w, h, size = YOLOX_SIZE) {
  const r = Math.min(size / w, size / h);
  const nw = Math.min(size, Math.round(w * r));
  const nh = Math.min(size, Math.round(h * r));
  const plane = size * size;
  const out = new Float32Array(3 * plane).fill(114);
  // Ближайший сосед из уже уменьшенного кадра (кадр приходит почти нужного размера)
  for (let y = 0; y < nh; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / nh));
    for (let x = 0; x < nw; x++) {
      const sx = Math.min(w - 1, Math.floor(((x + 0.5) * w) / nw));
      const i = (sy * w + sx) * 4;
      const o = y * size + x;
      out[o] = rgba[i + 2]; // B
      out[plane + o] = rgba[i + 1]; // G
      out[2 * plane + o] = rgba[i]; // R
    }
  }
  return { data: out, ratio: nw / w, nw, nh };
}

function iou(a, b) {
  const x0 = Math.max(a.x0, b.x0);
  const y0 = Math.max(a.y0, b.y0);
  const x1 = Math.min(a.x1, b.x1);
  const y1 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const ua = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return ua > 0 ? inter / ua : 0;
}

// Ответ модели → предметы [{ cls, name, score, x0, y0, x1, y1 }] в долях кадра (0…1), по убыванию оценки.
// nw×nh — где в квадрате лежит кадр (из yoloxInput). Порог 0,3 и NMS 0,45 — как в демо YOLOX.
export function yoloxDecode(out, { nw, nh, size = YOLOX_SIZE, scoreThr = 0.3, nmsThr = 0.45, max = 30 } = {}) {
  const C = 85;
  const found = [];
  let row = 0;
  for (const stride of YOLOX_STRIDES) {
    const g = Math.floor(size / stride);
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++, row++) {
        const o = row * C;
        const obj = out[o + 4];
        if (obj < scoreThr) continue;
        let best = 0;
        let cls = -1;
        for (let k = 0; k < 80; k++) {
          const s = out[o + 5 + k];
          if (s > best) {
            best = s;
            cls = k;
          }
        }
        const score = obj * best;
        if (score < scoreThr) continue;
        const cx = (out[o] + gx) * stride;
        const cy = (out[o + 1] + gy) * stride;
        const bw = Math.exp(out[o + 2]) * stride;
        const bh = Math.exp(out[o + 3]) * stride;
        const clamp = (v) => Math.min(1, Math.max(0, v));
        found.push({ cls, score, x0: clamp((cx - bw / 2) / nw), y0: clamp((cy - bh / 2) / nh), x1: clamp((cx + bw / 2) / nw), y1: clamp((cy + bh / 2) / nh) });
      }
    }
  }
  found.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of found) {
    if (d.x1 - d.x0 < 0.005 || d.y1 - d.y0 < 0.005) continue;
    if (keep.some((k) => k.cls === d.cls && iou(k, d) > nmsThr)) continue;
    keep.push({ ...d, name: COCO[d.cls], score: Math.round(d.score * 1000) / 1000 });
    if (keep.length >= max) break;
  }
  return keep;
}

// Площадь рамки в долях кадра
export const boxArea = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
