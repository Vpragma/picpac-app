// Анализатор фото — чистые функции без DOM (работают в воркере и в unit-тестах).
// Вход: пиксели RGBA уменьшенного снимка (длинная сторона ≈ 512). Выход: метрики, проблемы, оценка
// и мягкие параметры автоулучшения — только для явно плохих фото.

export const ANALYSIS_SIDE = 512; // до какого размера уменьшаем снимок для анализа
export const ANALYSIS_VERSION = 2; // 2 — отпечаток для поиска дублей

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const r3 = (v) => Math.round(v * 1000) / 1000;

export function analyzePixels(data, w, h) {
  const n = w * h;
  const luma = new Float32Array(n);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sl = 0;
  let sl2 = 0;
  let hi = 0;
  let lo = 0;
  const hist = new Uint32Array(256);
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luma[j] = l;
    sr += r;
    sg += g;
    sb += b;
    sl += l;
    sl2 += l * l;
    hist[l | 0]++;
    if (r >= 250 && g >= 250 && b >= 250) hi++;
    else if (l >= 250) hi += 0.5;
    if (l <= 8) lo++;
  }
  const mean = sl / n;
  const std = Math.sqrt(Math.max(0, sl2 / n - mean * mean));
  const pct = (q) => {
    let acc = 0;
    const target = q * n;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i;
    }
    return 255;
  };
  // Цветовой оттенок по «серому миру»: средние каналы должны быть близки
  const mr = sr / n;
  const mg = sg / n;
  const mb = sb / n;
  const gray = (mr + mg + mb) / 3 || 1;
  const cast = { r: mr / gray, g: mg / gray, b: mb / gray };

  // Резкость: дисперсия лапласиана; шум: метод Иммеркера (свёртка с ядром [1 −2 1; −2 4 −2; 1 −2 1])
  let lapSum = 0;
  let lapSum2 = 0;
  let noiseSum = 0;
  let cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const k = y * w + x;
      const c = luma[k];
      const up = luma[k - w];
      const dn = luma[k + w];
      const lf = luma[k - 1];
      const rt = luma[k + 1];
      const lap = up + dn + lf + rt - 4 * c;
      lapSum += lap;
      lapSum2 += lap * lap;
      const im = luma[k - w - 1] + luma[k - w + 1] + luma[k + w - 1] + luma[k + w + 1] - 2 * (up + dn + lf + rt) + 4 * c;
      noiseSum += Math.abs(im);
      cnt++;
    }
  }
  const lapMean = cnt ? lapSum / cnt : 0;
  // Дисперсия лапласиана, делённая на дисперсию яркости: тёмное, но чёткое фото не считается размытым
  const lapVar = cnt ? lapSum2 / cnt - lapMean * lapMean : 0;
  const sharpness = (lapVar / Math.max(std * std, 25)) * 1000;
  const noise = cnt ? (Math.sqrt(Math.PI / 2) * noiseSum) / (6 * cnt) : 0;

  // Оттенок светлых участков (5% самых светлых точек): у настоящего «цветного налёта» белое тоже окрашено,
  // а у заката или рыжего кота светлое почти нейтрально — их не трогаем
  const thr = pct(0.95);
  let hr = 0;
  let hg = 0;
  let hb = 0;
  let hn = 0;
  for (let i = 0, j = 0; j < n; i += 4, j++) {
    if (luma[j] >= thr) {
      hr += data[i];
      hg += data[i + 1];
      hb += data[i + 2];
      hn++;
    }
  }
  const hm = (hr + hg + hb) / 3 / (hn || 1) || 1;
  const hcast = hn ? { r: hr / hn / hm, g: hg / hn / hm, b: hb / hn / hm } : { r: 1, g: 1, b: 1 };

  return {
    v: ANALYSIS_VERSION,
    w,
    h,
    hash: dHash(luma, w, h),
    mean: r3(mean / 255),
    p05: r3(pct(0.05) / 255),
    p50: r3(pct(0.5) / 255),
    p95: r3(pct(0.95) / 255),
    contrast: r3(std / 255),
    clipHigh: r3(hi / n),
    clipLow: r3(lo / n),
    cast: { r: r3(cast.r), g: r3(cast.g), b: r3(cast.b) },
    castStrength: r3(Math.max(Math.abs(cast.r - 1), Math.abs(cast.g - 1), Math.abs(cast.b - 1))),
    highCast: { r: r3(hcast.r), g: r3(hcast.g), b: r3(hcast.b) },
    highCastStrength: r3(Math.max(Math.abs(hcast.r - 1), Math.abs(hcast.g - 1), Math.abs(hcast.b - 1))),
    sharpness: Math.round(sharpness),
    noise: Math.round(noise * 10) / 10,
  };
}

// Отпечаток для поиска дублей (dHash 9×8 → 64 бита, 16 шестнадцатеричных знаков)
function dHash(luma, w, h) {
  const gw = 9;
  const gh = 8;
  const cells = new Float64Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    const y0 = Math.floor((gy * h) / gh);
    const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / gh));
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor((gx * w) / gw);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / gw));
      let sum = 0;
      let cnt = 0;
      for (let y = y0; y < y1 && y < h; y++) for (let x = x0; x < x1 && x < w; x++, cnt++) sum += luma[y * w + x];
      cells[gy * gw + gx] = cnt ? sum / cnt : 0;
    }
  }
  let hex = "";
  for (let gy = 0; gy < gh; gy++) {
    let byte = 0;
    for (let gx = 0; gx < 8; gx++) byte = (byte << 1) | (cells[gy * gw + gx] < cells[gy * gw + gx + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

// Сколько бит отличается у двух отпечатков (0 — одинаковые снимки)
export function hashDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export const DUPLICATE_DISTANCE = 14; // на галерее: дубль «Луговая герань» — 13, разные снимки — от 17

// Дубли в проекте: id фото, у которых раньше в списке есть почти такой же снимок
export function findDuplicates(photos) {
  const out = new Set();
  const seen = [];
  for (const p of photos) {
    const h = p?.quality?.metrics?.hash;
    if (!h) continue;
    if (seen.some((x) => hashDistance(x, h) <= DUPLICATE_DISTANCE)) out.add(p.id);
    seen.push(h);
  }
  return out;
}

// Пороги подобраны на «Тестовой галерее» (tests/unit/photo-analyze.test.mjs): хорошие фото не задевают
export const LIMITS = {
  darkMean: 0.26, // средняя яркость
  darkMedian: 0.24, // и половина точек темнее этого
  darkTop: 0.55, // и даже светлые 5% темнее этого
  brightMean: 0.62,
  brightMedian: 0.7,
  clipHigh: 0.25, // доля совсем белых точек (белый фон сам по себе не пересвет)
  cast: 0.3, // оттенок «серого мира»
  highCast: 0.3, // и оттенок светлых участков
  flat: 0.11,
  blurry: 15, // нормированная резкость
  noisy: 12,
};

// Список проблем: { id, label, text, level }. dpi — печатное разрешение на своём месте (если известно).
export function problemsFrom(m, { dpi = null } = {}) {
  const out = [];
  if (!m) return out;
  if (m.mean < LIMITS.darkMean && m.p50 < LIMITS.darkMedian && m.p95 < LIMITS.darkTop)
    out.push({ id: "dark", label: "Темно", text: "Фото тёмное: детали в тенях плохо видны в печати.", level: "warn" });
  if (m.clipHigh > LIMITS.clipHigh || (m.mean > LIMITS.brightMean && m.p50 > LIMITS.brightMedian))
    out.push({ id: "bright", label: "Пересвет", text: "Фото пересвечено: полностью белое не восстановить, но остальное можно смягчить.", level: "warn" });
  if (m.castStrength > LIMITS.cast && (m.highCastStrength ?? 1) > LIMITS.highCast)
    out.push({ id: "cast", label: "Оттенок", text: "Заметный цветовой оттенок — поправим баланс белого.", level: "info" });
  if (m.contrast < LIMITS.flat && !out.some((p) => p.id === "dark" || p.id === "bright"))
    out.push({ id: "flat", label: "Блёкло", text: "Мало контраста — фото выглядит блёклым.", level: "info" });
  if (m.sharpness < LIMITS.blurry) out.push({ id: "blurry", label: "Размыто", text: "Фото нечёткое. Сильную размытость не исправить — лучше заменить снимок.", level: "warn" });
  if (m.noise > LIMITS.noisy) out.push({ id: "noisy", label: "Шум", text: "Заметный цифровой шум (часто бывает у ночных снимков).", level: "info" });
  if (dpi != null && dpi < 150)
    out.push({ id: "dpi", label: "Мало точек для печати", text: `${dpi} точек на дюйм на своём месте — может выйти нечётко (нужно от 150).`, level: dpi < 100 ? "err" : "warn" });
  return out;
}

// Оценка качества 0…100
export function qualityScore(m, problems) {
  if (!m) return null;
  const pen = { dark: 25, bright: 25, cast: 10, flat: 10, blurry: 30, noisy: 8, dpi: 20 };
  return clamp(100 - problems.reduce((s, p) => s + (pen[p.id] || 5), 0), 0, 100);
}

// Мягкое автоулучшение (только для явно плохих фото): экспозиция, светлые и тени, баланс белого,
// контраст, лёгкая насыщенность. null — фото хорошее, не трогаем.
export function autoParams(m, { force = false } = {}) {
  if (!m) return null;
  const ids = problemsFrom(m).map((p) => p.id);
  const fixable = ids.filter((id) => id === "dark" || id === "bright" || id === "cast" || id === "flat");
  if (!fixable.length && !force) return null;
  const p = { exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, warmth: 0 };
  const mean = Math.max(0.02, m.mean);
  if (ids.includes("dark")) {
    p.exposure = clamp((Math.log2(0.42 / mean) / 1.2) * 100 * 0.9, 10, 100);
    p.shadows = mean < 0.15 ? 35 : 25;
    p.highlights = -10;
  } else if (ids.includes("bright")) {
    p.exposure = clamp((Math.log2(0.6 / mean) / 1.2) * 100, -50, -8);
    p.highlights = -35;
    p.contrast = 10;
  } else if (force) {
    // «Улучши» на нормальном фото — совсем мягко подтянуть к середине
    p.exposure = clamp((Math.log2(0.46 / mean) / 1.2) * 100 * 0.5, -15, 15);
    p.contrast = 6;
  }
  if (ids.includes("flat")) p.contrast += 18;
  let wb = [1, 1, 1];
  if (ids.includes("cast")) {
    // 75% поправки по среднему «серого мира» и оттенка светлых участков, в пределах −30…+45%
    const hc = m.highCast || m.cast;
    wb = ["r", "g", "b"].map((k) => clamp(1 + (2 / (m.cast[k] + hc[k]) - 1) * 0.75, 0.7, 1.45));
  }
  p.saturation = ids.includes("cast") ? 4 : 8;
  const out = {};
  for (const [k, v] of Object.entries(p)) if (Math.abs(v) >= 0.5) out[k] = Math.round(v);
  if (wb.some((g) => Math.abs(g - 1) > 0.01)) out.wb = wb.map((g) => Math.round(g * 1000) / 1000);
  return out;
}

// Итог анализа для проекта: метрики + проблемы + оценка (dpi добавляется на месте, у него размер печати)
export function summarize(metrics) {
  const problems = problemsFrom(metrics);
  return { v: ANALYSIS_VERSION, metrics, problems: problems.map((p) => p.id), score: qualityScore(metrics, problems) };
}
