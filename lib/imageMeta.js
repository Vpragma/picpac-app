// Тип и размеры фото по первым байтам файла (не доверяем имени и заголовку Content-Type).
// Поддерживаем только JPEG и PNG. Возвращает { mime, width, height } или null.

// Предел размера кадра: 100 мегапикселей. Больше — «бомба» для памяти (PNG 20000×20000 весит килобайты,
// а при распаковке занимает 1,6 ГБ). Проверяем по заголовку, до декодирования, и на сервере, и на устройстве.
export const MAX_PIXELS = 100_000_000;
export function tooManyPixels(meta) {
  return !!meta && meta.width > 0 && meta.height > 0 && meta.width * meta.height > MAX_PIXELS;
}

export function sniffImage(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    // PNG: первый блок — IHDR, ширина и высота по 4 байта
    const width = readU32(b, 16);
    const height = readU32(b, 20);
    return width > 0 && height > 0 ? { mime: "image/png", width, height } : null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    // JPEG: ищем маркер SOFn с размерами кадра
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = (b[i + 5] << 8) | b[i + 6];
        const width = (b[i + 7] << 8) | b[i + 8];
        return width > 0 && height > 0 ? { mime: "image/jpeg", width, height } : null;
      }
      if (len < 2) return null;
      i += 2 + len;
    }
    return { mime: "image/jpeg", width: 0, height: 0 };
  }
  return null;
}

function readU32(b, i) {
  return ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
}
