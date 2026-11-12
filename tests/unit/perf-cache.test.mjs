// N5: кэш и сервис-воркер — правила, от которых зависят цифры скорости и то, что пользователь не застрянет на старой версии.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nextConfig from "../../next.config.mjs";

const rules = await nextConfig.headers();
const cacheFor = (source) => rules.find((r) => r.source === source)?.headers.find((h) => h.key === "Cache-Control")?.value;

test("веса моделей (.onnx, .bin) — год и immutable, а JSON рядом и wasm ORT — нет (меняются на месте)", () => {
  const weights = rules.find((r) => r.source.startsWith("/models/") && /onnx/.test(r.source));
  assert.ok(weights, "правило для весов моделей");
  assert.match(weights.headers[0].value, /max-age=31536000, immutable/);
  // Порядок важен: правило для весов — после общего /models/:path* (последнее совпавшее побеждает)
  assert.ok(rules.indexOf(weights) > rules.findIndex((r) => r.source === "/models/:path*"));
  assert.doesNotMatch(cacheFor("/models/:path*"), /immutable/);
  assert.doesNotMatch(cacheFor("/ort/:path*"), /immutable/);
  // Путь весов ловит .onnx и .bin, но не .json
  const re = new RegExp("^" + weights.source.replace("/models/:path(", "/models/(") + "$");
  assert.ok(re.test("/models/yolox-nano/yolox_nano.onnx"));
  assert.ok(re.test("/models/upscaler/x2/group1-shard1of1.bin"));
  assert.ok(!re.test("/models/rubert-tiny/intents.json"));
});

test("каждая страница отдаёт версию сборки X-App-Version (по ней воркер отдаёт оболочку из кэша)", () => {
  const all = rules.find((r) => r.source === "/:path*");
  const v = all.headers.find((h) => h.key === "X-App-Version")?.value;
  assert.ok(v && v.length >= 3);
  assert.equal(v, nextConfig.env.NEXT_PUBLIC_APP_VERSION);
});

test("фото: сначала AVIF, потом WebP", () => {
  assert.deepEqual(nextConfig.images.formats, ["image/avif", "image/webp"]);
});

test("сервис-воркер: из кэша сразу — только копию своей версии, чужую не хранит; новая версия → picpac-meta", () => {
  const sw = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /if \(saved && versionOf\(saved\) === VERSION\) return saved;/);
  assert.match(sw, /versionOf\(res\) === VERSION \? res\.clone\(\) : null/);
  assert.match(sw, /const META = "picpac-meta"/);
  const pwa = readFileSync(new URL("../../components/Pwa.js", import.meta.url), "utf8");
  assert.match(pwa, /\/__picpac\/latest-version/);
});
