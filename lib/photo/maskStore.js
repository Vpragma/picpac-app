// Хранение масок выделения в правках фото (D1) — лёгкий модуль без пиксельной математики: его используют
// редактор, воркер печати и оформление заказа (lib/photo/print.js). Формат — в начале lib/photo/mask.js:
//   edits.masks = { ключ: { w, h, rle } } — каждая маска один раз; правка ссылается на неё: { kind: "mask", act, id, m }.
import { PHOTO_EDITS_MAX, editsBytes } from "./edits.js";

export const PHOTO_EDITS_SAFE = PHOTO_EDITS_MAX - 500; // запас: редактор не даёт подойти к пределу сервера вплотную

// Короткий ключ маски по содержимому (FNV-1a): одинаковое выделение → тот же ключ
export function maskKey(m) {
  const s = m.w + "x" + m.h + ":" + m.rle;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const sameMask = (a, b) => !!a && !!b && a.w === b.w && a.h === b.h && a.rle === b.rle;

// Маска правки: внутри правки (старый вид) или по ключу в edits.masks
export function opMask(op, edits) {
  if (op?.mask) return op.mask;
  return op?.m ? edits?.masks?.[op.m] || null : null;
}

// Сложить маски в edits.masks (каждая один раз) и убрать те, на которые больше никто не ссылается.
// Без потерь: маски не пересжимаются, меняется только способ хранения.
export function packEdits(edits) {
  const ops = Array.isArray(edits?.ops) ? edits.ops : [];
  const masks = {};
  const outOps = ops.map((op) => {
    if (op?.kind !== "mask") return op;
    const m = opMask(op, edits);
    if (!m) return op;
    let k = maskKey(m);
    while (masks[k] && !sameMask(masks[k], m)) k += "x";
    masks[k] = m;
    const rest = { ...op };
    delete rest.mask;
    return { ...rest, m: k };
  });
  const out = { ...edits, ops: outOps };
  if (Object.keys(masks).length) out.masks = masks;
  else delete out.masks;
  return out;
}

// Правки с масками внутри каждой правки — для превью, печати и ластика (в памяти, не для хранения)
export function hydrateOps(edits) {
  const ops = Array.isArray(edits?.ops) ? edits.ops : [];
  const out = [];
  for (const op of ops) {
    if (op?.kind !== "mask") {
      out.push(op);
      continue;
    }
    const m = opMask(op, edits);
    if (m) out.push({ ...op, mask: m });
  }
  return out;
}

// Поместятся ли правки фото на сервер (тот же расчёт, что у сервера печатной версии)
export function editsFit(edits) {
  return editsBytes(edits) <= PHOTO_EDITS_SAFE;
}
