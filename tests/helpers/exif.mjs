// Тестовые метаданные фото (N3): EXIF с ориентацией и GPS, XMP, комментарий, «хвост» после конца кадра.
// Нужны unit-тесту lib/photo/stripMeta.js и e2e «фото в хранилище без EXIF и GPS».
const u16be = (v) => [(v >> 8) & 255, v & 255];
const u32be = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
export const ascii = (s) => [...s].map((c) => c.charCodeAt(0));

// TIFF (big endian): IFD0 { Orientation, GPSInfo → IFD с широтой «N 53°54'» }
export function tiff(orientation = 6) {
  const ifd0 = 8;
  const gps = ifd0 + 2 + 2 * 12 + 4;
  const lat = gps + 2 + 2 * 12 + 4;
  return [
    ...ascii("MM"), ...u16be(42), ...u32be(ifd0),
    ...u16be(2),
    ...u16be(0x0112), ...u16be(3), ...u32be(1), ...u16be(orientation), 0, 0,
    ...u16be(0x8825), ...u16be(4), ...u32be(1), ...u32be(gps),
    ...u32be(0),
    ...u16be(2),
    ...u16be(1), ...u16be(2), ...u32be(2), ...ascii("N"), 0, 0, 0,
    ...u16be(2), ...u16be(5), ...u32be(3), ...u32be(lat),
    ...u32be(0),
    ...u32be(53), ...u32be(1), ...u32be(54), ...u32be(1), ...u32be(0), ...u32be(1),
  ];
}

const segment = (marker, payload) => [0xff, marker, ...u16be(payload.length + 2), ...payload];

// JPEG + EXIF (ориентация, GPS) + XMP + комментарий + хвост после EOI
export function jpegWithMeta(base, orientation = 6) {
  const exif = segment(0xe1, [...ascii("Exif"), 0, 0, ...tiff(orientation)]);
  const xmp = segment(0xe1, [...ascii("http://ns.adobe.com/xap/1.0/"), 0, ...ascii("<x:xmpmeta>GPS 53.9</x:xmpmeta>")]);
  const com = segment(0xfe, ascii("Snyato na telefon, Minsk"));
  const tail = ascii("SEFT trailer: GPS=53.9,27.56");
  return new Uint8Array([...base.subarray(0, 2), ...exif, ...xmp, ...com, ...base.subarray(2), ...tail]);
}
