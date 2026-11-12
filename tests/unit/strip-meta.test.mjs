// N3: при загрузке фото в аккаунт и в заказ снимаем EXIF и GPS (lib/photo/stripMeta.js).
// JPEG с EXIF (ориентация 6, GPS-координаты), XMP, комментарием и «хвостом» после конца кадра → без них,
// кадр тот же байт в байт (без перекодирования). PNG с tEXt и eXIf → без них. Ориентация читается до удаления.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasPhotoMeta, jpegOrientation, pngOrientation, stripJpegMeta, stripPngMeta } from "../../lib/photo/stripMeta.js";

import { ascii, jpegWithMeta as withMeta, tiff } from "../helpers/exif.mjs";

const u32be = (v) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

// Настоящий JPEG из тестовой галереи + EXIF/GPS, XMP, комментарий и хвост после EOI
function jpegWithMeta(orientation = 6) {
  const base = new Uint8Array(readFileSync(new URL("../../public/demo-gallery/thumbs/dog.jpg", import.meta.url)));
  return { base, file: withMeta(base, orientation) };
}

const has = (bytes, text) => Buffer.from(bytes).includes(Buffer.from(text));

test("JPEG: ориентация из EXIF читается (6 — «на боку»), без EXIF — 1", () => {
  assert.equal(jpegOrientation(jpegWithMeta(6).file), 6);
  assert.equal(jpegOrientation(jpegWithMeta(1).file), 1);
  assert.equal(jpegOrientation(jpegWithMeta(1).base), 1);
});

test("JPEG: EXIF, GPS, XMP, комментарий и хвост убраны, сам кадр не перекодирован", () => {
  const { base, file } = jpegWithMeta(1);
  assert.ok(hasPhotoMeta(file));
  assert.ok(has(file, "Exif") && has(file, "GPS"));
  const clean = stripJpegMeta(file);
  assert.ok(!has(clean, "Exif"), "EXIF остался");
  assert.ok(!has(clean, "GPS"), "GPS остался");
  assert.ok(!has(clean, "xmpmeta"), "XMP остался");
  assert.ok(!has(clean, "Minsk"), "комментарий остался");
  assert.ok(!hasPhotoMeta(clean));
  // Кадр: от SOS до EOI — те же байты, что в исходном файле
  const sos = (b) => Buffer.from(b).indexOf(Buffer.from([0xff, 0xda]));
  assert.deepEqual(Buffer.from(clean.subarray(sos(clean))), Buffer.from(base.subarray(sos(base))));
  assert.equal(clean[clean.length - 2], 0xff);
  assert.equal(clean[clean.length - 1], 0xd9);
});

test("JPEG без метаданных не меняется", () => {
  const { base } = jpegWithMeta(1);
  const once = stripJpegMeta(base);
  assert.deepEqual(Buffer.from(stripJpegMeta(once)), Buffer.from(once));
});

// PNG: CRC32 для собранных блоков
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const x of bytes) c = CRC[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const td = [...ascii(type), ...data];
  return [...u32be(data.length), ...td, ...u32be(crc32(td))];
}
function pngWithMeta(orientation = 1) {
  // PNG 1×1 (RGBA) — IHDR, IDAT, IEND
  const ihdr = chunk("IHDR", [...u32be(1), ...u32be(1), 8, 6, 0, 0, 0]);
  const idat = chunk("IDAT", [0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0, 0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d]);
  const iend = chunk("IEND", []);
  const text = chunk("tEXt", [...ascii("Comment"), 0, ...ascii("GPS 53.9 27.56")]);
  const exif = chunk("eXIf", tiff(orientation));
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...ihdr, ...text, ...exif, ...idat, ...iend]);
}

test("PNG: tEXt и eXIf убраны, ориентация читается", () => {
  const file = pngWithMeta(8);
  assert.equal(pngOrientation(file), 8);
  assert.ok(hasPhotoMeta(file));
  const clean = stripPngMeta(file);
  assert.ok(!has(clean, "GPS"));
  assert.ok(!has(clean, "eXIf") && !has(clean, "tEXt"));
  assert.ok(has(clean, "IHDR") && has(clean, "IDAT") && has(clean, "IEND"));
  assert.ok(!hasPhotoMeta(clean));
});

test("загрузка в аккаунт идёт через cleanForUpload (lib/sync.js)", () => {
  const src = readFileSync(new URL("../../lib/sync.js", import.meta.url), "utf8");
  assert.match(src, /cleanForUpload\(/);
});
