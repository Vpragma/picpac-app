// Unit-тесты проверки фото по первым байтам: JPEG и PNG проходят, остальное — нет.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { sniffImage } from "../../lib/imageMeta.js";

const gallery = new URL("../../public/demo-gallery/", import.meta.url);

test("JPEG из тестовой галереи: тип и размеры из файла", () => {
  const meta = sniffImage(readFileSync(new URL("nesvizh-small.jpg", gallery)));
  assert.equal(meta.mime, "image/jpeg");
  assert.equal(meta.width, 800);
  assert.ok(meta.height > 0);
});

test("PNG: размеры из блока IHDR", () => {
  // Минимальный заголовок PNG 3×2
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000030000000208020000", "hex");
  assert.deepEqual(sniffImage(png), { mime: "image/png", width: 3, height: 2 });
});

test("не фото (GIF, текст, пустой файл) — null", () => {
  assert.equal(sniffImage(Buffer.from("GIF89a....", "ascii")), null);
  assert.equal(sniffImage(Buffer.from("<html>hello</html>", "ascii")), null);
  assert.equal(sniffImage(new Uint8Array(0)), null);
});

test("в тестовой галерее 18+ фото, у каждого есть лицензия и источник", () => {
  const manifest = JSON.parse(readFileSync(new URL("manifest.json", gallery), "utf8"));
  assert.ok(manifest.items.length >= 18);
  for (const item of manifest.items) {
    assert.ok(item.license && item.source && item.author, item.file);
    assert.ok(item.bytes <= 400 * 1024, `${item.file} больше 400 КБ`);
    assert.ok(Math.max(item.width, item.height) <= 1600, `${item.file} больше 1600 px`);
    const meta = sniffImage(readFileSync(new URL(item.file, gallery)));
    assert.equal(meta?.mime, "image/jpeg", item.file);
  }
  const problems = new Set(manifest.items.map((i) => i.problem));
  for (const p of [null, "dark", "overexposed", "color-cast", "blurry", "low-resolution", "sun", "stranger", "beach", "tilted", "duplicate"]) {
    assert.ok(problems.has(p), `нет фото с проблемой ${p}`);
  }
});
