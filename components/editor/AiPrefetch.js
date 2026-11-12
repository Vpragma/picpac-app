"use client";
// «Скачать ИИ заранее» (ED, п. 4): модели выделения касанием и ластика (~71 МБ) — одной кнопкой, с размером и
// процентом, чтобы на слабой сети (площадка ~1,4 Мбит/с) не ждать минутами в момент правки. Файлы кладутся в тот же
// кэш, что использует сервис-воркер (picpac-models-v1, «сначала кэш»), — потом воркеры ИИ берут их оттуда без сети.
// На мобильной сети или с экономией трафика — сначала спрашиваем. «Отмена» останавливает загрузку.
import { useEffect, useRef, useState } from "react";
import { MIGAN_FILE, ORT_MJS, ORT_WASM, SAM_FILES } from "../../lib/photo/modelFiles";

const CACHE = "picpac-models-v1"; // то же имя, что MODELS в public/sw.js
const FILES = [...SAM_FILES, ORT_WASM, MIGAN_FILE, { url: ORT_MJS, size: 24738 }];
const TOTAL = FILES.reduce((s, f) => s + f.size, 0);
const MB = Math.round(TOTAL / 1e6);

async function missingFiles() {
  if (typeof caches === "undefined") return FILES;
  const cache = await caches.open(CACHE);
  const out = [];
  for (const f of FILES) if (!(await cache.match(f.url))) out.push(f);
  return out;
}

// На мобильной сети или с экономией трафика — спросить перед загрузкой
function meteredNetwork() {
  const c = typeof navigator !== "undefined" ? navigator.connection : null;
  return !!c && (c.saveData || c.type === "cellular" || /(^|-)2g|3g/.test(c.effectiveType || ""));
}

export default function AiPrefetch({ compact = false }) {
  const [state, setState] = useState({ status: "checking" }); // checking | ready | missing | ask | loading | error
  const abort = useRef(null);

  useEffect(() => {
    let alive = true;
    missingFiles()
      .then((m) => alive && setState(m.length ? { status: "missing", left: m.reduce((s, f) => s + f.size, 0) } : { status: "ready" }))
      .catch(() => alive && setState({ status: "missing", left: TOTAL }));
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  async function download() {
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const need = await missingFiles();
      const total = need.reduce((s, f) => s + f.size, 0) || 1;
      let before = 0;
      setState({ status: "loading", p: 0 });
      const cache = typeof caches !== "undefined" ? await caches.open(CACHE) : null;
      for (const f of need) {
        const res = await fetch(f.url, { signal: ctrl.signal, cache: "no-store" });
        if (!res.ok || !res.body) throw new Error("HTTP " + res.status);
        const reader = res.body.getReader();
        const chunks = [];
        let n = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          n += value.length;
          setState({ status: "loading", p: Math.min(1, (before + Math.min(n, f.size)) / total) });
        }
        const type = f.url.endsWith(".wasm") ? "application/wasm" : f.url.endsWith(".json") ? "application/json" : f.url.endsWith(".mjs") ? "text/javascript" : "application/octet-stream";
        if (cache) await cache.put(f.url, new Response(new Blob(chunks, { type }), { headers: { "Content-Type": type } }));
        before += f.size;
      }
      setState({ status: "ready", just: true });
    } catch (e) {
      if (ctrl.signal.aborted) setState({ status: "missing", left: TOTAL });
      else setState({ status: "error" });
    } finally {
      abort.current = null;
    }
  }

  const start = () => (meteredNetwork() ? setState((s) => ({ ...s, status: "ask" })) : download());
  const pct = Math.round((state.p || 0) * 100);

  if (state.status === "checking") return null;
  return (
    <div className={"ai-prefetch" + (compact ? " compact" : "")} data-ai-prefetch={state.status}>
      {state.status === "ready" ? (
        <p className="small ok-text" role="status">
          {state.just ? "Готово: ИИ скачан на это устройство" : "ИИ уже на этом устройстве"} — выделение касанием и ластик откроются без ожидания.
        </p>
      ) : state.status === "loading" ? (
        <>
          <p className="small" role="status" aria-live="polite">
            Скачиваем ИИ: {pct}% из {MB} МБ. Можно продолжать работу.
          </p>
          <progress className="pe-progress" max={100} value={pct} aria-label="Скачиваем ИИ" />
          <button type="button" className="btn btn-small" onClick={() => abort.current?.abort()}>
            Отмена
          </button>
        </>
      ) : state.status === "ask" ? (
        <>
          <p className="small" role="status">
            Похоже, сейчас мобильный интернет или экономия трафика. Скачать {MB} МБ сейчас?
          </p>
          <div className="row wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-small btn-primary" onClick={download}>
              Скачать {MB} МБ
            </button>
            <button type="button" className="btn btn-small" onClick={() => setState({ status: "missing", left: TOTAL })}>
              Не сейчас
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="small muted">
            {state.status === "error" ? "Не получилось скачать — проверьте интернет и попробуйте ещё раз. " : ""}
            Выделение касанием и ластик работают на устройстве; их модели — около {MB} МБ. Скачайте заранее, пока есть хорошая сеть.
          </p>
          <button type="button" className="btn btn-small" onClick={start}>
            Скачать ИИ заранее ({MB} МБ)
          </button>
        </>
      )}
    </div>
  );
}
