// Местные правки без нейросетей (S03c, часть): «убери солнце», «убери блики».
// Чистые функции без DOM — работают в превью редактора, в воркере печатной версии и в unit-тестах.
//
// Правка хранится в photo.edits.ops маленьким объектом, без файла маски (лимит settings 50 КБ):
//   { kind: "heal", cx, cy, r } — круг в долях кадра (cx, cy — от ширины и высоты, r — от большей стороны).
// Заливка: «луковая» (от края круга внутрь — среднее известных соседей), затем сглаживание
// (итерации Лапласа) — небо и ровный фон затягиваются без шва. Пиксели вне круга не меняются.

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

// Затянуть круг op (доли кадра fullW×fullH) в буфере data размером w×h, который начинается в (offX, offY) кадра
export function healCircle(data, w, h, op, offX = 0, offY = 0, fullW = w, fullH = h) {
  const side = Math.max(fullW, fullH);
  const cx = op.cx * fullW - offX;
  const cy = op.cy * fullH - offY;
  const r = Math.max(2, op.r * side);
  const x0 = Math.max(1, Math.floor(cx - r));
  const x1 = Math.min(w - 2, Math.ceil(cx + r));
  const y0 = Math.max(1, Math.floor(cy - r));
  const y1 = Math.min(h - 2, Math.ceil(cy + r));
  if (x1 < x0 || y1 < y0) return data;
  const bw = x1 - x0 + 1;
  const bh = y1 - y0 + 1;
  const hole = new Uint8Array(bw * bh); // 1 — заполнить
  const todo = [];
  const r2 = r * r;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
        hole[(y - y0) * bw + (x - x0)] = 1;
        todo.push(y * w + x);
      }
    }
  }
  if (!todo.length) return data;
  const inHole = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && hole[(y - y0) * bw + (x - x0)] === 1;
  // 1) «Луковая» заливка от края внутрь
  let left = todo;
  let guard = 0;
  while (left.length && guard++ < 4 * r + 10) {
    const filled = [];
    const rest = [];
    for (const p of left) {
      const x = p % w;
      const y = (p - x) / w;
      let n = 0;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || inHole(nx, ny)) continue;
          const j = (ny * w + nx) * 4;
          sr += data[j];
          sg += data[j + 1];
          sb += data[j + 2];
          n++;
        }
      }
      if (n) filled.push([p, sr / n, sg / n, sb / n]);
      else rest.push(p);
    }
    if (!filled.length) break;
    for (const [p, cr, cg, cb] of filled) {
      const i = p * 4;
      data[i] = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      const x = p % w;
      hole[((p - x) / w - y0) * bw + (x - x0)] = 2; // заполнено
    }
    left = rest;
  }
  // 2) Сглаживание внутри круга (Лаплас): убирает лучи от «луковой» заливки
  const iters = Math.min(60, Math.round(r / 2) + 10);
  for (let it = 0; it < iters; it++) {
    for (const p of todo) {
      const i = p * 4;
      for (let k = 0; k < 3; k++) data[i + k] = (data[i - 4 + k] + data[i + 4 + k] + data[i - w * 4 + k] + data[i + w * 4 + k]) / 4;
    }
  }
  return data;
}

// Круг правки в пикселях кадра w×h (для чтения нужной области в воркере)
export function opBox(op, w, h, pad = 2) {
  const side = Math.max(w, h);
  const r = op.r * side + pad;
  const x = Math.max(0, Math.floor(op.cx * w - r));
  const y = Math.max(0, Math.floor(op.cy * h - r));
  return { x, y, w: Math.min(w, Math.ceil(op.cx * w + r)) - x, h: Math.min(h, Math.ceil(op.cy * h + r)) - y };
}

// Все местные правки по порядку, после света и цвета
export function applyOps(data, w, h, ops) {
  for (const op of ops || []) if (op?.kind === "heal") healCircle(data, w, h, op);
  return data;
}
