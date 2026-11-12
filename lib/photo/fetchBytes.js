// Загрузка файлов моделей с честным процентом (D1): читаем поток и считаем байты сами — сервер может отдавать
// файл сжатым и без Content-Length. Размер берём из lib/photo/modelFiles.js. Процент только растёт.

// Один файл → Uint8Array; onBytes(n) — сколько байт уже прочитано
export async function fetchBytes(url, expected = 0, onBytes = () => {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Не загрузился файл модели (" + res.status + ")");
  if (!res.body || typeof res.body.getReader !== "function") {
    const all = new Uint8Array(await res.arrayBuffer());
    onBytes(all.length);
    return all;
  }
  const reader = res.body.getReader();
  let buf = new Uint8Array(expected > 0 ? expected : 1 << 20);
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (n + value.length > buf.length) {
      const bigger = new Uint8Array(Math.max(buf.length * 2, n + value.length));
      bigger.set(buf.subarray(0, n));
      buf = bigger;
    }
    buf.set(value, n);
    n += value.length;
    onBytes(n);
  }
  return n === buf.length ? buf : buf.slice(0, n);
}

// Несколько файлов по очереди с общим процентом 0…1 → Map(url → Uint8Array)
export async function fetchAll(files, onProgress = () => {}) {
  const total = files.reduce((s, f) => s + f.size, 0) || 1;
  let before = 0;
  let last = -1;
  const out = new Map();
  const report = (p) => {
    const v = Math.min(1, Math.max(last, p));
    if (v - last >= 0.005 || v === 1) {
      last = v;
      onProgress(v);
    }
  };
  report(0);
  for (const f of files) {
    const bytes = await fetchBytes(f.url, f.size, (n) => report((before + Math.min(n, f.size)) / total));
    out.set(f.url, bytes);
    before += f.size;
    report(before / total);
  }
  return out;
}
