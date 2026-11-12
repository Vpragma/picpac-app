// Местные правки по маске (D1 / S03c): выделение касанием → «Размыть фон», «Осветлить», «Затемнить», «Убрать».
// Чистые функции без DOM — работают в превью редактора, в воркере печатной версии и в unit-тестах.
//
// Как хранится (лимит правок фото на сервере — PHOTO_EDITS_MAX = 20 КБ, настроек проекта — 50 КБ):
//   photo.edits.masks = { <ключ>: { w, h, rle } } — каждая маска один раз (одинаковое выделение не дублируется);
//   photo.edits.ops   = [{ kind: "mask", act: "blurBg" | "lighten" | "darken" | "erase", id, m: <ключ> }, …].
// Старый вид правки с маской внутри ({ …, mask: { w, h, rle } }, D1 до исправлений) тоже читается.
// Маска — в своём маленьком размере (длинная сторона ≤ MASK_SIDE), сжатая RLE → base64; сложную маску (листва)
// уменьшаем, пока она не станет ≤ MASK_RLE_MAX символов. Так 8 правок по выделению всегда помещаются в лимит фото.
// На любом размере кадра (превью или печать в полном разрешении) маска растягивается билинейно с мягким краем,
// поэтому превью и печать совпадают. «Убрать» (ластик MI-GAN) нужен нейросети и считается отдельно
// (lib/photo/erase.js), до света и цвета; остальные — после света и цвета, как «убери солнце».
import { buildLuts } from "./adjust.js";
import { packEdits } from "./maskStore.js";

// Хранение масок (лёгкий модуль без пиксельной математики — его берёт и оформление заказа)
export { PHOTO_EDITS_SAFE, editsFit, hydrateOps, maskKey, opMask, packEdits } from "./maskStore.js";

export const MASK_SIDE = 320; // длинная сторона хранимой маски
export const MASK_SIDES = [320, 256, 200, 160, 128, 96]; // если маска сложная — пробуем мельче
export const MASK_RLE_MAX = 1800; // символов на одну маску (8 масок ≈ 15 КБ < 20 КБ)
export const MASK_ACTS = ["blurBg", "lighten", "darken", "erase"];
export const MAX_MASK_OPS = 8; // правок по маске на одно фото
const BLUR_SIDE = 400; // размытый фон считаем в уменьшенной копии кадра (длинная сторона) — одинаково для превью и печати
const BLUR_R = 4; // радиус «коробки» в уменьшенной копии; 3 прохода ≈ гауссово размытие ~1 % кадра
const FEATHER = 2; // мягкий край маски — в точках маски (≈ 0,6 % кадра)
const TONE = { lighten: 38, darken: -38 }; // «Осветлить» / «Затемнить» — как ползунок «Яркость» ±38 внутри маски

// ---------- Маска: сжатие и размеры ----------

function toB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// bits — Uint8Array w×h (не 0 — выделено). Серии «нет / да / нет …», числа — varint (LEB128), затем base64
export function encodeMask(bits, w, h) {
  const bytes = [];
  const push = (n) => {
    while (n > 127) {
      bytes.push((n & 127) | 128);
      n >>>= 7;
    }
    bytes.push(n);
  };
  let cur = 0;
  let run = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    const v = bits[i] ? 1 : 0;
    if (v === cur) run++;
    else {
      push(run);
      cur = v;
      run = 1;
    }
  }
  push(run);
  return { w, h, rle: toB64(Uint8Array.from(bytes)) };
}

export function decodeMask(m) {
  if (!m || !(m.w > 0) || !(m.h > 0) || typeof m.rle !== "string") return null;
  const out = new Uint8Array(m.w * m.h);
  let bytes;
  try {
    bytes = fromB64(m.rle);
  } catch {
    return null;
  }
  let pos = 0;
  let cur = 0;
  let i = 0;
  while (i < bytes.length && pos <= out.length) {
    let n = 0;
    let shift = 0;
    let b;
    do {
      b = bytes[i++];
      n |= (b & 127) << shift;
      shift += 7;
    } while (b & 128 && i < bytes.length);
    if (cur) out.fill(1, pos, Math.min(out.length, pos + n));
    pos += n;
    cur ^= 1;
  }
  return out;
}

// Уменьшить (или растянуть) маску: доля выделенного в клетке ≥ 0,5 → выделено
export function resizeMask(bits, w, h, tw, th) {
  const out = new Uint8Array(tw * th);
  const kx = w / tw;
  const ky = h / th;
  if (kx <= 1 && ky <= 1) {
    for (let y = 0; y < th; y++) {
      const sy = Math.min(h - 1, Math.floor((y + 0.5) * ky));
      for (let x = 0; x < tw; x++) out[y * tw + x] = bits[sy * w + Math.min(w - 1, Math.floor((x + 0.5) * kx))] ? 1 : 0;
    }
    return out;
  }
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * ky);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * ky)));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * kx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * kx)));
      let s = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += bits[yy * w + xx] ? 1 : 0;
      out[y * tw + x] = s * 2 >= (y1 - y0) * (x1 - x0) ? 1 : 0;
    }
  }
  return out;
}

// Размер хранимой маски для кадра w×h (пропорции кадра, длинная сторона ≤ MASK_SIDE)
export function maskSize(w, h, side = MASK_SIDE) {
  const k = Math.min(1, side / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export function maskArea(bits) {
  let n = 0;
  for (let i = 0; i < bits.length; i++) if (bits[i]) n++;
  return n;
}

// Рамка выделенного { x, y, w, h } или null
export function maskBox(bits, w, h) {
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!bits[y * w + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Расширить маску на r точек (квадратом). Проверено перебором в research-s03 (2.3)
export function dilate(mask, W, H, r) {
  if (r <= 0) return Uint8Array.from(mask, (v) => (v ? 1 : 0));
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let last = -1e9;
    for (let x = 0; x < W; x++) {
      if (mask[row + x]) last = x;
      if (x - last <= r) tmp[row + x] = 1;
    }
    last = 1e9;
    for (let x = W - 1; x >= 0; x--) {
      if (mask[row + x]) last = x;
      if (last - x <= r) tmp[row + x] = 1;
    }
  }
  for (let x = 0; x < W; x++) {
    let last = -1e9;
    for (let y = 0; y < H; y++) {
      if (tmp[y * W + x]) last = y;
      if (y - last <= r) out[y * W + x] = 1;
    }
    last = 1e9;
    for (let y = H - 1; y >= 0; y--) {
      if (tmp[y * W + x]) last = y;
      if (last - y <= r) out[y * W + x] = 1;
    }
  }
  return out;
}

// Объединить или вычесть маски одного размера (для «добавить» и «убрать» к выделению)
export function combineMasks(a, b, mode) {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = mode === "subtract" ? (a[i] && !b[i] ? 1 : 0) : a[i] || b[i] ? 1 : 0;
  return out;
}

// ---------- Мягкий край ----------

// Размытие «коробкой» одного канала Float32 (по строкам и столбцам), края — повтор крайнего значения
function boxBlur1(src, w, h, r) {
  if (r <= 0) return src;
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + Math.min(w - 1, Math.max(0, k))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s / d;
      s += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, k)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / d;
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

// Маска 0/1 → прозрачность 0…1 с мягким краем (два прохода «коробкой»)
export function featherMask(bits, w, h, r = FEATHER) {
  let a = Float32Array.from(bits, (v) => (v ? 1 : 0));
  a = boxBlur1(a, w, h, r);
  return boxBlur1(a, w, h, r);
}

// Билинейная выборка из сетки w×h в точке (u, v) — доли кадра 0…1
export function sampleGrid(a, w, h, u, v) {
  const gx = Math.min(w - 1, Math.max(0, u * w - 0.5));
  const gy = Math.min(h - 1, Math.max(0, v * h - 0.5));
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const jx = Math.min(w - 1, ix + 1);
  const jy = Math.min(h - 1, iy + 1);
  const tx = gx - ix;
  const ty = gy - iy;
  return (a[iy * w + ix] * (1 - tx) + a[iy * w + jx] * tx) * (1 - ty) + (a[jy * w + ix] * (1 - tx) + a[jy * w + jx] * tx) * ty;
}

// ---------- Уменьшенная копия и размытый фон ----------

// Уменьшить RGBA усреднением (для размытого фона)
export function downscaleRGBA(data, w, h, tw, th) {
  const out = new Float32Array(tw * th * 3);
  const kx = w / tw;
  const ky = h / th;
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor(y * ky);
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((y + 1) * ky)));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor(x * kx);
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((x + 1) * kx)));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
          n++;
        }
      }
      const k = (y * tw + x) * 3;
      out[k] = r / n;
      out[k + 1] = g / n;
      out[k + 2] = b / n;
    }
  }
  return out;
}

export function blurSize(w, h) {
  return maskSize(w, h, BLUR_SIDE);
}

// Размытый фон: уменьшенная копия кадра (Float32 RGB tw×th) → размытие без выделенного (чтобы предмет
// не «растекался» ореолом по фону): blur(цвет × фон) / blur(фон). alphaAt(u, v) — выделенность 0…1.
export function blurBackground(small, tw, th, alphaAt) {
  const n = tw * th;
  const wgt = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const k = y * tw + x;
      const bg = 1 - alphaAt((x + 0.5) / tw, (y + 0.5) / th);
      const wv = 0.02 + 0.98 * bg; // совсем без веса нельзя: внутри большого предмета будет пусто
      wgt[k] = wv;
      for (let c = 0; c < 3; c++) ch[c][k] = small[k * 3 + c] * wv;
    }
  }
  let W = wgt;
  let C = ch;
  for (let pass = 0; pass < 3; pass++) {
    W = boxBlur1(W, tw, th, BLUR_R);
    C = C.map((a) => boxBlur1(a, tw, th, BLUR_R));
  }
  const out = new Float32Array(n * 3);
  for (let k = 0; k < n; k++) for (let c = 0; c < 3; c++) out[k * 3 + c] = C[c][k] / W[k];
  return out;
}

// ---------- Применение правки ----------

// Подготовка правки по маске (один раз на кадр): прозрачность с мягким краем и, для фона, размытая копия.
// data — весь кадр w×h после света и цвета (или его уменьшенная копия smallFrame { data: Float32 RGB, w, h }).
export function prepareMaskOp(op, { data, w, h, smallFrame } = {}) {
  const bits = decodeMask(op?.mask);
  if (!bits) return null;
  const mw = op.mask.w;
  const mh = op.mask.h;
  const alpha = featherMask(bits, mw, mh);
  const alphaAt = (u, v) => sampleGrid(alpha, mw, mh, u, v);
  const prep = { op, alpha, mw, mh, alphaAt };
  if (op.act === "blurBg") {
    let sf = smallFrame;
    if (!sf) {
      const s = blurSize(w, h);
      sf = { data: downscaleRGBA(data, w, h, s.w, s.h), w: s.w, h: s.h };
    }
    prep.blur = { data: blurBackground(sf.data, sf.w, sf.h, alphaAt), w: sf.w, h: sf.h };
  }
  if (op.act === "lighten" || op.act === "darken") {
    prep.luts = buildLuts({ exposure: TONE[op.act], contrast: 0, warmth: 0, saturation: 0, highlights: 0, shadows: 0, wb: [1, 1, 1] });
  }
  return prep;
}

// Применить подготовленную правку к полосе кадра: data — RGBA bw×bh, начало полосы (offX, offY) в кадре fullW×fullH
export function applyMaskOp(data, bw, bh, prep, offX = 0, offY = 0, fullW = bw, fullH = bh) {
  if (!prep) return data;
  const { op, alpha, mw, mh } = prep;
  if (op.act === "erase") return data; // ластик — отдельно (lib/photo/erase.js)
  const blur = prep.blur;
  const luts = prep.luts;
  for (let y = 0; y < bh; y++) {
    const v = (y + offY + 0.5) / fullH;
    for (let x = 0; x < bw; x++) {
      const u = (x + offX + 0.5) / fullW;
      const a = sampleGrid(alpha, mw, mh, u, v);
      const i = (y * bw + x) * 4;
      if (blur) {
        const t = 1 - a; // фон — размыть
        if (t < 0.003) continue;
        for (let c = 0; c < 3; c++) {
          const b = sampleGridRGB(blur.data, blur.w, blur.h, u, v, c);
          data[i + c] = data[i + c] + (b - data[i + c]) * t;
        }
      } else if (luts) {
        if (a < 0.003) continue;
        data[i] = data[i] + (luts[0][data[i]] - data[i]) * a;
        data[i + 1] = data[i + 1] + (luts[1][data[i + 1]] - data[i + 1]) * a;
        data[i + 2] = data[i + 2] + (luts[2][data[i + 2]] - data[i + 2]) * a;
      }
    }
  }
  return data;
}

function sampleGridRGB(a, w, h, u, v, c) {
  const gx = Math.min(w - 1, Math.max(0, u * w - 0.5));
  const gy = Math.min(h - 1, Math.max(0, v * h - 0.5));
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const jx = Math.min(w - 1, ix + 1);
  const jy = Math.min(h - 1, iy + 1);
  const tx = gx - ix;
  const ty = gy - iy;
  return (a[(iy * w + ix) * 3 + c] * (1 - tx) + a[(iy * w + jx) * 3 + c] * tx) * (1 - ty) + (a[(jy * w + ix) * 3 + c] * (1 - tx) + a[(jy * w + jx) * 3 + c] * tx) * ty;
}

// Правка по маске для всего кадра сразу (превью, тесты)
export function applyMaskOpFull(data, w, h, op) {
  const prep = prepareMaskOp(op, { data, w, h });
  return applyMaskOp(data, w, h, prep);
}

// ---------- Создание правки ----------

let seq = 0;
const newId = () => Date.now().toString(36) + (seq++ % 1296).toString(36).padStart(2, "0");

// Маска выделения sw×sh → сжатая маска: длинная сторона 320, а если RLE длиннее MASK_RLE_MAX — мельче
export function encodeMaskAdaptive(bits, sw, sh) {
  let enc = null;
  for (const side of MASK_SIDES) {
    const s = maskSize(sw, sh, side);
    const small = sw === s.w && sh === s.h ? bits : resizeMask(bits, sw, sh, s.w, s.h);
    enc = encodeMask(small, s.w, s.h);
    if (enc.rle.length <= MASK_RLE_MAX) return enc;
  }
  return enc;
}

// Правка с маской внутри (для тестов и старых черновиков)
export function makeMaskOp(act, bits, sw, sh) {
  if (!MASK_ACTS.includes(act)) throw new Error("unknown act");
  return { kind: "mask", act, id: newId(), mask: encodeMaskAdaptive(bits, sw, sh) };
}

export const isEraseOp = (o) => o?.kind === "mask" && o.act === "erase";
export const isMaskTone = (o) => o?.kind === "mask" && o.act !== "erase";

// Добавить правку по выделению: маска сжимается и хранится один раз → { edits, op }
export function addMaskOp(edits, act, bits, sw, sh) {
  if (!MASK_ACTS.includes(act)) throw new Error("unknown act");
  const mask = encodeMaskAdaptive(bits, sw, sh);
  const op = { kind: "mask", act, id: newId(), mask };
  return { edits: packEdits({ ...edits, ops: [...(edits?.ops || []), op] }), op };
}


// Правки фото → { erase: ластик (до света и цвета), rest: остальные местные правки по порядку }
export function splitOps(ops) {
  const list = Array.isArray(ops) ? ops : [];
  return { erase: list.filter(isEraseOp), rest: list.filter((o) => !isEraseOp(o)) };
}

// Ключ результата ластика (для кэша превью): одинаковые маски — тот же результат
export function eraseKey(photoId, eraseOps) {
  return photoId + ":" + eraseOps.map((o) => o.id).join(",");
}

// ---------- Ластик: вырезка вокруг маски ----------

// Вырезка кадра fullW×fullH вокруг маски: рамка + поля 50 % (не меньше 64 точек), и размер для нейросети
// (длинная сторона ≤ maxSide). Нейросеть сама работает в 512, поэтому большую вырезку уменьшаем — печать не теряет.
export function eraseCrop(op, fullW, fullH, maxSide = 1024) {
  const bits = decodeMask(op?.mask);
  if (!bits) return null;
  const box = maskBox(bits, op.mask.w, op.mask.h);
  if (!box) return null;
  const sx = fullW / op.mask.w;
  const sy = fullH / op.mask.h;
  const bx = box.x * sx;
  const by = box.y * sy;
  const bw = box.w * sx;
  const bh = box.h * sy;
  const padX = Math.max(64, bw * 0.5);
  const padY = Math.max(64, bh * 0.5);
  const x = Math.max(0, Math.floor(bx - padX));
  const y = Math.max(0, Math.floor(by - padY));
  const x2 = Math.min(fullW, Math.ceil(bx + bw + padX));
  const y2 = Math.min(fullH, Math.ceil(by + bh + padY));
  const w = x2 - x;
  const h = y2 - y;
  const k = Math.min(1, maxSide / Math.max(w, h));
  return { x, y, w, h, iw: Math.max(8, Math.round(w * k)), ih: Math.max(8, Math.round(h * k)) };
}

// Дыра для нейросети в размере iw×ih вырезки crop (кадр fullW×fullH): маска растянута и расширена
// (край и тень предмета тоже уходят). Возвращает { hole: Uint8Array (1 — убрать), alpha: Float32Array (мягкий край) }
export function eraseHole(op, crop, fullW, fullH) {
  const bits = decodeMask(op.mask);
  const { iw, ih } = crop;
  const hole0 = new Uint8Array(iw * ih);
  const mw = op.mask.w;
  const mh = op.mask.h;
  for (let y = 0; y < ih; y++) {
    const fy = crop.y + ((y + 0.5) / ih) * crop.h;
    const my = Math.min(mh - 1, Math.floor((fy / fullH) * mh));
    for (let x = 0; x < iw; x++) {
      const fx = crop.x + ((x + 0.5) / iw) * crop.w;
      const mx = Math.min(mw - 1, Math.floor((fx / fullW) * mw));
      hole0[y * iw + x] = bits[my * mw + mx];
    }
  }
  // Расширение: клетка маски в точках вырезки + ~1,5 % вырезки (не меньше 6 точек)
  const cell = Math.max(iw / ((crop.w / fullW) * mw), ih / ((crop.h / fullH) * mh));
  const r = Math.round(Math.max(6, cell * 0.75 + Math.max(iw, ih) * 0.015));
  const hole = dilate(hole0, iw, ih, r);
  const fr = Math.max(2, Math.round(r / 2));
  const alpha = featherMask(hole, iw, ih, Math.ceil(fr / 2));
  // Внутри исходной маски — заменить полностью
  for (let i = 0; i < alpha.length; i++) if (hole0[i]) alpha[i] = 1;
  return { hole, alpha, r };
}

// Вклейка: orig и up — RGBA w×h, alpha — мягкая маска в размере iw×ih (растягиваем билинейно)
export function blendUp(orig, up, alpha, iw, ih, w, h) {
  for (let y = 0; y < h; y++) {
    const gy = Math.min(ih - 1, Math.max(0, ((y + 0.5) / h) * ih - 0.5));
    const iy = Math.floor(gy);
    const jy = Math.min(ih - 1, iy + 1);
    const ty = gy - iy;
    for (let x = 0; x < w; x++) {
      const gx = Math.min(iw - 1, Math.max(0, ((x + 0.5) / w) * iw - 0.5));
      const ix = Math.floor(gx);
      const jx = Math.min(iw - 1, ix + 1);
      const tx = gx - ix;
      const a = (alpha[iy * iw + ix] * (1 - tx) + alpha[iy * iw + jx] * tx) * (1 - ty) + (alpha[jy * iw + ix] * (1 - tx) + alpha[jy * iw + jx] * tx) * ty;
      if (a <= 0.002) continue;
      const i = (y * w + x) * 4;
      orig[i] = orig[i] + (up[i] - orig[i]) * a;
      orig[i + 1] = orig[i + 1] + (up[i + 1] - orig[i + 1]) * a;
      orig[i + 2] = orig[i + 2] + (up[i + 2] - orig[i + 2]) * a;
    }
  }
  return orig;
}

// RGBA → CHW (RGB) и дыра → маска MI-GAN (255 — оставить, 0 — закрасить)
export function toMiganInputs(rgba, hole, iw, ih) {
  const n = iw * ih;
  const chw = new Uint8Array(3 * n);
  const keep = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    chw[k] = rgba[k * 4];
    chw[n + k] = rgba[k * 4 + 1];
    chw[2 * n + k] = rgba[k * 4 + 2];
    keep[k] = hole[k] ? 0 : 255;
  }
  return { chw, keep };
}
