// Воркер проверки фото на устройстве (W-15 → N4): классификатор обнажённости (Marqo ViT-tiny, 22 МБ) и CLIP ViT-B/32
// (визуальный энкодер int8, 89 МБ) — оба из public/models/moderation, onnxruntime-web — из public/ort (свой сайт,
// без сторонних хостов). Модели качаются при первой проверке и кэшируются сервис-воркером.
// Сообщение { id, blob, lite } → { id, ok, scores: { v, nsfw, breast, nude, sex, nazi, weapon, blood, drugs, art } }.
// lite (режим экономии трафика) — только классификатор обнажённости, без CLIP; полную проверку всё равно делает сервер.
import { fetchAll, fetchBytes } from "./fetchBytes.js";
import { ORT_WASM } from "./modelFiles.js";
import { needsWasm, ort, setupOrt, setWasmBinary } from "./ort.js";
import { CLIP_MODEL, CLIP_SIZE, CLIP_TEXT, NSFW_MODEL, NSFW_SIZE, clipCategories, clipInput, moderationScores, nsfwInput, nsfwProb } from "./moderationModel.js";

const OPTS = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
let nsfwP = null;
let clipP = null;

function loadNsfw() {
  setupOrt();
  nsfwP ??= (async () => {
    const files = [...(needsWasm() ? [ORT_WASM] : []), { url: NSFW_MODEL.path, size: NSFW_MODEL.size }];
    const bytes = await fetchAll(files);
    if (bytes.has(ORT_WASM.url)) setWasmBinary(bytes.get(ORT_WASM.url));
    return ort.InferenceSession.create(bytes.get(NSFW_MODEL.path), OPTS);
  })().catch((e) => {
    nsfwP = null;
    throw e;
  });
  return nsfwP;
}

function loadClip() {
  clipP ??= (async () => {
    await loadNsfw(); // wasm ORT уже на месте
    const [model, text] = await Promise.all([
      fetchBytes(CLIP_MODEL.path, CLIP_MODEL.size),
      fetch(CLIP_TEXT.path).then((r) => {
        if (!r.ok) throw new Error("Не загрузились классы проверки (" + r.status + ")");
        return r.json();
      }),
    ]);
    return { session: await ort.InferenceSession.create(model, OPTS), text };
  })().catch((e) => {
    clipP = null;
    throw e;
  });
  return clipP;
}

// Два квадрата из фото: 384×384 целиком (классификатор) и 224×224 из центра (CLIP). Прозрачное — на белом.
async function squares(blob) {
  let bmp;
  try {
    bmp = await createImageBitmap(blob, { resizeWidth: 768, resizeQuality: "high" });
  } catch {
    bmp = await createImageBitmap(blob);
  }
  const draw = (size, sx, sy, sw, sh) => {
    const c = new OffscreenCanvas(size, size);
    const g = c.getContext("2d", { willReadFrequently: true });
    g.fillStyle = "#fff";
    g.fillRect(0, 0, size, size);
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(bmp, sx, sy, sw, sh, 0, 0, size, size);
    return g.getImageData(0, 0, size, size).data;
  };
  const w = bmp.width;
  const h = bmp.height;
  const s = Math.min(w, h);
  const out = { nsfwPx: draw(NSFW_SIZE, 0, 0, w, h), clipPx: draw(CLIP_SIZE, (w - s) / 2, (h - s) / 2, s, s) };
  bmp.close?.();
  return out;
}

self.onmessage = async (e) => {
  const { id, blob, lite } = e.data || {};
  try {
    const nsfw = await loadNsfw();
    const { nsfwPx, clipPx } = await squares(blob);
    const o1 = await nsfw.run({ [nsfw.inputNames[0]]: new ort.Tensor("float32", nsfwInput(nsfwPx, 4), [1, 3, NSFW_SIZE, NSFW_SIZE]) });
    const p = nsfwProb(o1[nsfw.outputNames[0]].data);
    let cats = null;
    if (!lite) {
      const { session, text } = await loadClip();
      const o2 = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", clipInput(clipPx, 4), [1, 3, CLIP_SIZE, CLIP_SIZE]) });
      cats = clipCategories(o2[session.outputNames[0]].data, text);
    }
    self.postMessage({ id, ok: true, scores: moderationScores(p, cats) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
