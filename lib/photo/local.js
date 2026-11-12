// Местные правки без нейросетей (S03c, часть): «убери солнце», «убери блики».
// Чистые функции без DOM — работают в превью редактора, в воркере печатной версии и в unit-тестах.
//
// Правка хранится в photo.edits.ops маленьким объектом, без файла маски (лимит settings 50 КБ):
//   { kind: "heal", cx, cy, r } — круг в долях кадра (cx, cy — от ширины и высоты, r — от большей стороны).
// Заливка «push-pull» по пирамиде из цветов вокруг круга — небо и ровный фон затягиваются без шва.
// Пиксели вне круга не меняются.

// Самая яркая компактная область (солнце, блик). data — RGBA, w×h. Нет яркого пятна — null.
export function findSun(data, w, h) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 320));
  const gw = Math.floor(w / step);
  const gh = Math.floor(h / step);
  const lum = new Float32Array(gw * gh);
  let maxL = 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const i = (y * step * w + x * step) * 4;
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      lum[y * gw + x] = l;
      if (l > maxL) maxL = l;
    }
  }
  if (maxL < 230) return null;
  const T = Math.max(222, maxL - 14);
  const seen = new Uint8Array(gw * gh);
  const area = gw * gh;
  let best = null;
  for (let s = 0; s < area; s++) {
    if (seen[s] || lum[s] < T) continue;
    // Связная область ярких клеток
    const stack = [s];
    seen[s] = 1;
    let n = 0;
    let sx = 0;
    let sy = 0;
    let x0 = gw;
    let y0 = gh;
    let x1 = 0;
    let y1 = 0;
    let peak = 0;
    while (stack.length) {
      const c = stack.pop();
      const x = c % gw;
      const y = (c - x) / gw;
      n++;
      sx += x;
      sy += y;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (lum[c] > peak) peak = lum[c];
      for (const d of [c - 1, c + 1, c - gw, c + gw]) {
        if (d < 0 || d >= area || seen[d] || lum[d] < T) continue;
        if ((d === c - 1 && x === 0) || (d === c + 1 && x === gw - 1)) continue;
        seen[d] = 1;
        stack.push(d);
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    const fill = n / (bw * bh);
    const aspect = bw / bh;
    // Солнце — небольшое и круглое; большое светлое небо — это пересвет, не солнце
    if (n < 3 || n > area * 0.06 || fill < 0.4 || aspect < 0.45 || aspect > 2.2) continue;
    const score = peak * 4 + Math.sqrt(n);
    if (!best || score > best.score) best = { score, cx: (sx / n + 0.5) * step, cy: (sy / n + 0.5) * step, r: (Math.max(bw, bh) / 2) * step };
  }
  if (!best) return null;
  // Вместе с ореолом: радиус ×1,9 и запас, но не больше 22 % кадра
  const side = Math.max(w, h);
  const r = Math.min(side * 0.22, best.r * 1.9 + side * 0.01);
  return { kind: "heal", cx: best.cx / w, cy: best.cy / h, r: r / side };
}

// Затянуть круг op (доли кадра fullW×fullH) в буфере data размером w×h, который начинается в (offX, offY) кадра.
// Заливка «push-pull» (пирамида): дыра заполняется плавной «мембраной» из цветов вокруг круга — без лучей и швов.
export function healCircle(data, w, h, op, offX = 0, offY = 0, fullW = w, fullH = h) {
  const side = Math.max(fullW, fullH);
  const cx = op.cx * fullW - offX;
  const cy = op.cy * fullH - offY;
  const r = Math.max(2, op.r * side);
  const m = Math.max(4, Math.round(r * 0.35)); // кольцо известных пикселей вокруг круга
  const x0 = Math.max(0, Math.floor(cx - r - m));
  const x1 = Math.min(w - 1, Math.ceil(cx + r + m));
  const y0 = Math.max(0, Math.floor(cy - r - m));
  const y1 = Math.min(h - 1, Math.ceil(cy + r + m));
  if (x1 <= x0 || y1 <= y0) return data;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const r2 = r * r;
  // Уровень 0: цвет × вес (вес 0 — дыра)
  let lw = bw;
  let lh = bh;
  let W = new Float32Array(bw * bh);
  let C = new Float32Array(bw * bh * 3);
  let holes = 0;
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const k = y * bw + x;
      const inside = (x + x0 - cx) ** 2 + (y + y0 - cy) ** 2 <= r2;
      if (inside) {
        holes++;
        continue;
      }
      const i = ((y + y0) * w + x + x0) * 4;
      W[k] = 1;
      C[k * 3] = data[i];
      C[k * 3 + 1] = data[i + 1];
      C[k * 3 + 2] = data[i + 2];
    }
  }
  if (!holes) return data;
  const levels = [{ W, C, w: lw, h: lh }];
  // Pull: усреднение 2×2 вверх по пирамиде
  while (lw > 1 || lh > 1) {
    const nw = Math.ceil(lw / 2);
    const nh = Math.ceil(lh / 2);
    const NW = new Float32Array(nw * nh);
    const NC = new Float32Array(nw * nh * 3);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        let sw = 0;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const px = 2 * x + dx;
            const py = 2 * y + dy;
            if (px >= lw || py >= lh) continue;
            const k = py * lw + px;
            sw += W[k];
            sr += C[k * 3];
            sg += C[k * 3 + 1];
            sb += C[k * 3 + 2];
          }
        }
        const k = y * nw + x;
        if (sw > 0) {
          const nwt = Math.min(1, sw);
          NW[k] = nwt;
          NC[k * 3] = (sr / sw) * nwt;
          NC[k * 3 + 1] = (sg / sw) * nwt;
          NC[k * 3 + 2] = (sb / sw) * nwt;
        }
      }
    }
    W = NW;
    C = NC;
    lw = nw;
    lh = nh;
    levels.push({ W, C, w: lw, h: lh });
  }
  // Push: сверху вниз, недостающее берём из грубого уровня (билинейно)
  for (let l = levels.length - 2; l >= 0; l--) {
    const f = levels[l];
    const c = levels[l + 1];
    const cc = new Float32Array(c.w * c.h * 3);
    for (let k = 0; k < c.w * c.h; k++) {
      const wt = c.W[k] || 1e-6;
      cc[k * 3] = c.C[k * 3] / wt;
      cc[k * 3 + 1] = c.C[k * 3 + 1] / wt;
      cc[k * 3 + 2] = c.C[k * 3 + 2] / wt;
    }
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const k = y * f.w + x;
        if (f.W[k] >= 1) continue;
        const gx = Math.min(c.w - 1, Math.max(0, (x - 0.5) / 2));
        const gy = Math.min(c.h - 1, Math.max(0, (y - 0.5) / 2));
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const jx = Math.min(c.w - 1, ix + 1);
        const jy = Math.min(c.h - 1, iy + 1);
        const tx = gx - ix;
        const ty = gy - iy;
        const a = (iy * c.w + ix) * 3;
        const b = (iy * c.w + jx) * 3;
        const d = (jy * c.w + ix) * 3;
        const e = (jy * c.w + jx) * 3;
        const rest = 1 - f.W[k];
        for (let ch = 0; ch < 3; ch++) {
          const v = (cc[a + ch] * (1 - tx) + cc[b + ch] * tx) * (1 - ty) + (cc[d + ch] * (1 - tx) + cc[e + ch] * tx) * ty;
          f.C[k * 3 + ch] += rest * v;
        }
        f.W[k] = 1;
      }
    }
  }
  // Запись: только пиксели внутри круга
  const L = levels[0];
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      if ((x + x0 - cx) ** 2 + (y + y0 - cy) ** 2 > r2) continue;
      const k = y * bw + x;
      const i = ((y + y0) * w + x + x0) * 4;
      data[i] = L.C[k * 3];
      data[i + 1] = L.C[k * 3 + 1];
      data[i + 2] = L.C[k * 3 + 2];
    }
  }
  return data;
}

// Круг правки в пикселях кадра w×h (для чтения нужной области в воркере)
export function opBox(op, w, h, pad = 2) {
  const side = Math.max(w, h);
  const r = op.r * side * 1.4 + 4 + pad; // круг и кольцо известных пикселей вокруг (как в healCircle)
  const x = Math.max(0, Math.floor(op.cx * w - r));
  const y = Math.max(0, Math.floor(op.cy * h - r));
  return { x, y, w: Math.min(w, Math.ceil(op.cx * w + r)) - x, h: Math.min(h, Math.ceil(op.cy * h + r)) - y };
}

// Все местные правки по порядку, после света и цвета
export function applyOps(data, w, h, ops) {
  for (const op of ops || []) if (op?.kind === "heal") healCircle(data, w, h, op);
  return data;
}
