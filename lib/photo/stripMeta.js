// Без EXIF и GPS (N3): фото уходит в наше хранилище (аккаунт, заказ) без данных о месте съёмки, камере,
// времени, авторе и встроенных миниатюр. Сначала ориентация из EXIF переносится в сами пиксели (иначе фото,
// снятое «боком», без EXIF легло бы на бок), потом метаданные удаляются.
//
// JPEG без поворота — без перекодирования (качество не теряется): удаляем сегменты APP1 (EXIF, XMP), APP3–APP13
// (в т. ч. Photoshop/IPTC с подписями и местом), APP15, комментарии COM и всё после конца кадра (вложенные
// превью MPF, служебные хвосты телефонов). Оставляем APP0 (JFIF), APP2 ICC_PROFILE (цвета) и APP14 Adobe (как
// декодировать цвета). JPEG с поворотом — рисуем повёрнутым и сохраняем заново (JPEG 0,95, без метаданных).
// PNG — удаляем блоки eXIf, tEXt, zTXt, iTXt, tIME (с поворотом в eXIf — перерисовываем в PNG).
// Чистые функции (байты → байты) работают в node для unit-тестов; cleanForUpload — в браузере.

const isJpeg = (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const isPng = (b) => b.length > 8 && PNG_SIG.every((v, i) => b[i] === v);

// Ориентация из блока TIFF (EXIF): 1…8, 1 — «как есть»
function tiffOrientation(b, start, end) {
  if (end - start < 8) return 1;
  const le = b[start] === 0x49 && b[start + 1] === 0x49; // "II" — little endian, "MM" — big endian
  const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  if (u16(start + 2) !== 42) return 1;
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return 1;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > end) break;
    if (u16(e) === 0x0112) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

// Сегменты JPEG до начала сжатых данных: [{ marker, start, end }] (end — после сегмента) и где начинаются данные
function jpegSegments(b) {
  const segs = [];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return { segs, scan: -1 };
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    if (len < 2) return { segs, scan: -1 };
    segs.push({ marker, start: i, end: i + 2 + len });
    if (marker === 0xda) return { segs, scan: i }; // SOS — дальше сжатые данные
    i += 2 + len;
  }
  return { segs, scan: -1 };
}

export function jpegOrientation(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isJpeg(b)) return 1;
  for (const s of jpegSegments(b).segs) {
    // APP1 "Exif\0\0" + TIFF
    if (s.marker === 0xe1 && b[s.start + 4] === 0x45 && b[s.start + 5] === 0x78 && b[s.start + 6] === 0x69 && b[s.start + 7] === 0x66) return tiffOrientation(b, s.start + 10, s.end);
  }
  return 1;
}

// Конец кадра JPEG (после маркера EOI) — с учётом прогрессивного JPEG (несколько сканов с таблицами между ними)
function jpegEnd(b, from) {
  let i = from;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m === 0x00 || m === 0xff || (m >= 0xd0 && m <= 0xd7)) {
      i += m === 0xff ? 1 : 2; // байт-заполнитель, повтор 0xFF, метки рестарта — часть данных
      continue;
    }
    if (m === 0xd9) return i + 2; // EOI
    // Сегмент между сканами (DHT, SOS следующего скана и т. п.): пропустить заголовок
    if (i + 3 >= b.length) break;
    const len = (b[i + 2] << 8) | b[i + 3];
    i += 2 + Math.max(2, len);
  }
  return b.length;
}

const KEEP_APP = (b, s) => {
  if (s.marker === 0xe0) return true; // APP0 JFIF
  if (s.marker === 0xee) return true; // APP14 Adobe
  // APP2 — только цветовой профиль ICC_PROFILE (не MPF и не FlashPix)
  if (s.marker === 0xe2) return String.fromCharCode(...b.subarray(s.start + 4, s.start + 15)) === "ICC_PROFILE";
  return false;
};

// JPEG без метаданных (без перекодирования). Возвращает новый массив байтов
export function stripJpegMeta(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isJpeg(b)) return b;
  const { segs, scan } = jpegSegments(b);
  if (scan < 0) return b; // не разобрали — пусть решает сервер (он проверяет формат)
  const parts = [b.subarray(0, 2)];
  for (const s of segs) {
    const app = s.marker >= 0xe0 && s.marker <= 0xef;
    if ((app && !KEEP_APP(b, s)) || s.marker === 0xfe) continue; // APPn с метаданными, COM
    if (s.marker === 0xda) break;
    parts.push(b.subarray(s.start, s.end));
  }
  const end = jpegEnd(b, segs[segs.length - 1].end);
  parts.push(b.subarray(scan, end));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const DROP_PNG = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);
function pngChunks(b) {
  const out = [];
  let i = 8;
  while (i + 12 <= b.length) {
    const len = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const end = i + 12 + len;
    if (end > b.length) break;
    out.push({ type, start: i, end, data: i + 8 });
    i = end;
    if (type === "IEND") break;
  }
  return out;
}

export function pngOrientation(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isPng(b)) return 1;
  const ex = pngChunks(b).find((c) => c.type === "eXIf");
  return ex ? tiffOrientation(b, ex.data, ex.end - 4) : 1;
}

export function stripPngMeta(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isPng(b)) return b;
  const chunks = pngChunks(b);
  if (!chunks.length) return b;
  const keep = chunks.filter((c) => !DROP_PNG.has(c.type));
  const out = new Uint8Array(8 + keep.reduce((n, c) => n + (c.end - c.start), 0));
  out.set(b.subarray(0, 8), 0);
  let o = 8;
  for (const c of keep) {
    out.set(b.subarray(c.start, c.end), o);
    o += c.end - c.start;
  }
  return out;
}

// Есть ли в файле метаданные, которые мы убираем (для тестов и проверки)
export function hasPhotoMeta(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (isJpeg(b)) {
    const { segs, scan } = jpegSegments(b);
    if (segs.some((s) => (s.marker >= 0xe0 && s.marker <= 0xef && !KEEP_APP(b, s)) || s.marker === 0xfe)) return true;
    return scan > 0 && jpegEnd(b, segs[segs.length - 1].end) < b.length;
  }
  if (isPng(b)) return pngChunks(b).some((c) => DROP_PNG.has(c.type));
  return false;
}

// Браузер: Blob фото → Blob для загрузки в хранилище (тот же тип, без метаданных, ориентация — в пикселях)
export async function cleanForUpload(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const jpeg = isJpeg(bytes);
  const png = !jpeg && isPng(bytes);
  if (!jpeg && !png) return blob;
  const orient = jpeg ? jpegOrientation(bytes) : pngOrientation(bytes);
  if (orient !== 1) {
    const type = jpeg ? "image/jpeg" : "image/png";
    const redrawn = await redraw(blob, type).catch(() => null);
    if (redrawn) return redrawn;
  }
  const type = jpeg ? "image/jpeg" : "image/png";
  const clean = jpeg ? stripJpegMeta(bytes) : stripPngMeta(bytes);
  if (hasPhotoMeta(clean)) {
    // Необычный файл, который не разобрали по сегментам, — перерисовать (новый файл без метаданных). Не вышло —
    // не загружаем вовсе: синхронизация повторит позже, а фото с GPS в хранилище не попадёт
    const redrawn = await redraw(blob, type).catch(() => null);
    if (redrawn) return redrawn;
    throw new Error("Не получилось убрать данные о месте съёмки из фото");
  }
  return clean === bytes ? blob : new Blob([clean], { type });
}

// Нарисовать с учётом ориентации и сохранить заново (новый файл — без метаданных)
async function redraw(blob, type) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close?.();
  return c.convertToBlob(type === "image/png" ? { type } : { type, quality: 0.95 });
}
