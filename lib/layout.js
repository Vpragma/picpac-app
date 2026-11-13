// Автомакет: раскладываем фото по страницам (1–3 на страницу) с учётом
// вертикальных и горизонтальных снимков. Координаты мест — доли страницы (0..1).
// N11: поле страницы и зазор задаёт шаблон оформления (lib/book.js → layoutOptions); без шаблона — «Классика».

const M = 0.06; // поле страницы
const G = 0.03; // зазор между фото

export function orientation(photo) {
  if (!photo?.w || !photo?.h) return "square";
  if (photo.w > photo.h * 1.1) return "landscape";
  if (photo.h > photo.w * 1.1) return "portrait";
  return "square";
}

function template(list, M, G) {
  const inner = 1 - 2 * M;
  const o = list.map(orientation);
  if (list.length === 1) return [{ x: M, y: M, w: inner, h: inner }];
  if (list.length === 2) {
    const half = (inner - G) / 2;
    if (o[0] === "landscape" && o[1] === "landscape") {
      // одно под другим
      return [
        { x: M, y: M, w: inner, h: half },
        { x: M, y: M + half + G, w: inner, h: half },
      ];
    }
    // рядом
    return [
      { x: M, y: M, w: half, h: inner },
      { x: M + half + G, y: M, w: half, h: inner },
    ];
  }
  // 3 фото
  const half = (inner - G) / 2;
  if (o.every((x) => x === "landscape")) {
    const third = (inner - 2 * G) / 3;
    return [0, 1, 2].map((i) => ({ x: M, y: M + i * (third + G), w: inner, h: third }));
  }
  if (o[0] === "portrait") {
    // слева большое вертикальное, справа два
    return [
      { x: M, y: M, w: half, h: inner },
      { x: M + half + G, y: M, w: half, h: half },
      { x: M + half + G, y: M + half + G, w: half, h: half },
    ];
  }
  // сверху широкое, снизу два
  return [
    { x: M, y: M, w: inner, h: half },
    { x: M, y: M + half + G, w: half, h: half },
    { x: M + half + G, y: M + half + G, w: half, h: half },
  ];
}

// Возвращает { pages: [{ slots: [{photoId, x,y,w,h}] }], overflow: [photo] }
// opts: { margin, gap } — поле страницы и зазор шаблона (доли страницы)
export function autoLayout(photos, pageCount, opts = {}) {
  const m = Number.isFinite(opts.margin) ? Math.min(0.2, Math.max(0, opts.margin)) : M;
  const g = Number.isFinite(opts.gap) ? Math.min(0.1, Math.max(0, opts.gap)) : G;
  const P = photos.length;
  const N = pageCount;
  const counts = [];
  for (let i = 0; i < N; i++) {
    let c = P <= N ? (i < P ? 1 : 0) : Math.floor(((i + 1) * P) / N) - Math.floor((i * P) / N);
    counts.push(Math.min(3, c));
  }
  let k = 0;
  const pages = counts.map((c) => {
    const list = photos.slice(k, k + c);
    k += c;
    const t = c ? template(list, m, g) : [];
    return { slots: list.map((p, i) => ({ photoId: p.id, ...t[i] })) };
  });
  return { pages, overflow: photos.slice(k) };
}

// Эффективное разрешение фото на его месте (точек на дюйм).
// Фото заполняет место целиком (как object-fit: cover), поэтому берём меньшее.
// «Резкость для печати» (D1): фото увеличено ×2 — точек на дюйм вдвое больше
const upK = (photo) => (photo?.edits?.upscale === 2 ? 2 : 1);

export function slotDpi(photo, slot, pageWcm, pageHcm) {
  if (!photo?.w) return null;
  const wIn = (slot.w * pageWcm) / 2.54;
  const hIn = (slot.h * pageHcm) / 2.54;
  return Math.round(Math.min(photo.w / wIn, photo.h / hIn) * upK(photo));
}

// Для печати фото: длинная сторона снимка — на длинную сторону отпечатка.
export function printDpi(photo, size) {
  if (!photo?.w) return null;
  const long = Math.max(size.w, size.h) / 2.54;
  const short = Math.min(size.w, size.h) / 2.54;
  return Math.round(Math.min(Math.max(photo.w, photo.h) / long, Math.min(photo.w, photo.h) / short) * upK(photo));
}
