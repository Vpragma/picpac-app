// Подбор команды по смыслу (N3, SHOULD): фраза → вектор rubert-tiny ([CLS] последнего слоя, нормированный) →
// ближайшие смыслы из lib/photo/intents.js (по лучшему из примеров). Чистые функции: работают в воркере
// (lib/photo/meaning.worker.js) и в unit-тесте в node. Модель и словарь токенов — public/models/rubert-tiny.
import { INTENTS } from "./intents.js";

export const MEANING_DIR = "/models/rubert-tiny/";
export const MEANING_OUTPUT = "/bert/encoder/layer.2/output/LayerNorm/Add_1_output_0"; // скрытое состояние последнего слоя
// Пороги подобраны на 30 перефразировках (tests/unit/photo-meaning.test.mjs): при отрыве ≥ 0,03 первый смысл
// был верным во всех случаях; при меньшем отрыве — только в половине, поэтому тогда предлагаем 3 кнопки.
export const MEANING_SURE = 0.75; // не ниже — и с отрывом MEANING_GAP — выполняем сразу
export const MEANING_GAP = 0.03;
export const MEANING_MIN = 0.62; // ниже — даже не предлагаем

// Служебные слова, которые не несут смысла правки (иначе «сделай …» тянет к примерам с «сделай»)
// и служебные «как», «в», «на» (иначе «как на морозе» близко ко всем примерам вида «как в …»)
const FILLER = /(^|\s)(сделай|сделать|сделайте|пожалуйста|давай|можешь|можно|хочу|чтобы|чтоб|пусть|было|будет|будто|словно|типа|как|в|во|на|у|из|с|со|по|же|бы|это|этот|эту|мне|ну|а|и|ка|фото|фотку|фотографию|фотография|снимок|картинку)(?=\s|$)/g;
export function prepText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[«»"“”„!?.;:()]/g, " ")
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Вектор фразы. rt = { ort, session, tokenizer }
export async function embedText(rt, text) {
  const ids = rt.tokenizer.encode(prepText(text) || String(text || "")).ids.slice(0, 64);
  const n = ids.length;
  const feeds = {
    input_ids: new rt.ort.Tensor("int64", BigInt64Array.from(ids.map((x) => BigInt(x))), [1, n]),
    attention_mask: new rt.ort.Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), [1, n]),
  };
  if (rt.session.inputNames.includes("token_type_ids")) feeds.token_type_ids = new rt.ort.Tensor("int64", new BigInt64Array(n), [1, n]);
  const out = await rt.session.run(feeds, [MEANING_OUTPUT]);
  const h = out[MEANING_OUTPUT];
  const dim = h.dims[2];
  const v = new Float32Array(h.data.subarray(0, dim)); // [CLS]
  h.dispose?.();
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dim; i++) v[i] /= norm;
  return v;
}

// Векторы примеров — int8 в base64 (компактно: ~50 КБ на все примеры)
export function packVec(v) {
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127 * 4)));
  let s = "";
  for (const b of new Uint8Array(q.buffer)) s += String.fromCharCode(b);
  return btoa(s);
}
export function unpackVec(b64) {
  const s = atob(b64);
  const q = new Int8Array(s.length);
  for (let i = 0; i < s.length; i++) q[i] = (s.charCodeAt(i) << 24) >> 24;
  const v = new Float32Array(q.length);
  let norm = 0;
  for (let i = 0; i < q.length; i++) {
    v[i] = q[i];
    norm += v[i] * v[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

// Таблица примеров { id: [Float32Array, …] } из intents.json { v, dim, intents: { id: [base64, …] } }
export function loadTable(json) {
  const out = {};
  for (const [id, list] of Object.entries(json.intents || {})) out[id] = list.map(unpackVec);
  return out;
}

const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

// Смыслы по убыванию близости: [{ id, label, score }]
export function rankIntents(vec, table) {
  return INTENTS.filter((it) => table[it.id]?.length)
    .map((it) => ({ id: it.id, label: it.label, score: Math.max(...table[it.id].map((a) => dot(vec, a))) }))
    .sort((a, b) => b.score - a.score);
}

// Решение: уверенно — { pick }, иначе — { options } (до 3 вариантов для кнопок), совсем далеко — пусто
export function decide(ranked) {
  const [a, b] = ranked;
  if (!a || a.score < MEANING_MIN) return { pick: null, options: [] };
  if (a.score >= MEANING_SURE && (!b || a.score - b.score >= MEANING_GAP)) return { pick: a, options: ranked.slice(0, 3) };
  return { pick: null, options: ranked.slice(0, 3).filter((x) => x.score >= MEANING_MIN) };
}
