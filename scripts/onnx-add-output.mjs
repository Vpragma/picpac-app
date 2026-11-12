// Добавить выход графа ONNX (N3): у onnx-community/rubert-tiny-ONNX наружу выведены только logits головы MLM,
// а для смысла фразы нужен вектор [CLS] последнего слоя (так рекомендует автор rubert-tiny). Сам граф и веса
// не меняются — в список выходов дописывается уже существующий тензор (ModelProto.graph.output, ValueInfoProto).
// Запуск: node scripts/onnx-add-output.mjs <вход.onnx> <выход.onnx> <имя тензора> [новое имя выхода не меняется]
import { readFileSync, writeFileSync } from "node:fs";

function readVarint(b, i) {
  let v = 0;
  let shift = 0;
  let byte;
  do {
    byte = b[i++];
    v += (byte & 127) * 2 ** shift;
    shift += 7;
  } while (byte & 128);
  return [v, i];
}
function varint(n) {
  const out = [];
  while (n > 127) {
    out.push((n % 128) | 128);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
}
const field = (num, payload) => Buffer.concat([Buffer.from(varint(num * 8 + 2)), Buffer.from(varint(payload.length)), payload]);

export function addOutput(model, tensor) {
  const b = model;
  const parts = [];
  let i = 0;
  let found = false;
  while (i < b.length) {
    const start = i;
    const [tag, j] = readVarint(b, i);
    const num = Math.floor(tag / 8);
    const wire = tag & 7;
    i = j;
    if (wire === 0) [, i] = readVarint(b, i);
    else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else if (wire === 2) {
      const [len, k] = readVarint(b, i);
      const payload = b.subarray(k, k + len);
      i = k + len;
      if (num === 7) {
        // TypeProto { tensor_type { elem_type: FLOAT } }
        const tensorType = field(1, Buffer.from([0x08, 0x01]));
        const valueInfo = Buffer.concat([field(1, Buffer.from(tensor, "utf8")), field(2, tensorType)]);
        parts.push(field(7, Buffer.concat([payload, field(12, valueInfo)])));
        found = true;
        continue;
      }
    } else throw new Error("неизвестный тип поля " + wire);
    parts.push(b.subarray(start, i));
  }
  if (!found) throw new Error("нет графа");
  return Buffer.concat(parts);
}

if (process.argv[2]) {
  const [, , input, output, tensor] = process.argv;
  writeFileSync(output, addOutput(readFileSync(input), tensor));
  console.log("готово:", output);
}
