"use client";
// «Скачать ИИ заранее» (ED, п. 4): модели выделения касанием и ластика (~71 МБ) — одной кнопкой, с размером и
// процентом, чтобы на слабой сети (площадка ~1,4 Мбит/с) не ждать минутами в момент правки. Файлы кладутся в тот же
// кэш, что использует сервис-воркер (picpac-models-v1, «сначала кэш»), — потом воркеры ИИ берут их оттуда без сети.
// На мобильной сети или с экономией трафика — сначала спрашиваем. «Отмена» останавливает загрузку.
import { useEffect, useRef, useState } from "react";
import { warmWorkers } from "../../lib/photo/ai";
import { MEANING_FILES, MIGAN_FILE, ORT_MJS, ORT_WASM, SAM_FILES, UPSCALER_FILES, YOLOX_FILE } from "../../lib/photo/modelFiles";
import { warmUpscale } from "../../lib/photo/upscale";

const CACHE = "picpac-models-v1"; // то же имя, что MODELS в public/sw.js
// N3: и поиск предметов словом (YOLOX-Nano, 3,7 МБ), и «по смыслу» (rubert-tiny, 12,9 МБ) — редактор целиком без интернета
const FILES = [...SAM_FILES, ORT_WASM, MIGAN_FILE, YOLOX_FILE, ...MEANING_FILES, ...UPSCALER_FILES, { url: ORT_MJS, size: 24738 }];

// Код воркеров ИИ — тоже на устройство: дождаться сервис-воркера (он кладёт загруженное в кэш) и запустить
// каждый воркер на мгновение. Без сервис-воркера (dev, старый браузер) — просто пропускаем
async function warmCode() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const ready = await Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
  if (!ready) return;
  for (let i = 0; i < 20 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 250));
  if (!navigator.serviceWorker.controller) return;
  await Promise.allSettled([warmWorkers(), warmUpscale()]);
}
const TOTAL = FILES.reduce((s, f) => s + f.size, 0);
const MB = Math.round(TOTAL / 1e6);

async function missingFiles() {
  if (typeof caches === "undefined") return FILES;
  const cache = await caches.open(CACHE);
  const out = [];
  for (const f of FILES) if (!(await cache.match(f.url))) out.push(f);
  return out;
}

// N3: все модели ИИ уже в кэше устройства — редактор работает без интернета (индикатор в редакторе).
// dep — когда перепроверить (модели кэширует сервис-воркер при первом использовании). Событие picpac:ai-cached —
// после «Скачать ИИ заранее».
export function useAiOffline(dep) {
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick((t) => t + 1);
    window.addEventListener("picpac:ai-cached", f);
    return () => window.removeEventListener("picpac:ai-cached", f);
  }, []);
  useEffect(() => {
    let alive = true;
    missingFiles()
      .then((m) => alive && setReady(m.length === 0))
      .catch(() => alive && setReady(false));
    return () => {
      alive = false;
    };
  }, [dep, tick]);
  // Модели на устройстве — значит, и код воркеров нужен там же (один раз за сеанс, в фоне)
  useEffect(() => {
    if (!ready || warmed) return;
    warmed = true;
    warmCode().catch(() => {});
  }, [ready]);
  return ready;
}
let warmed = false;

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
      await warmCode().catch(() => {});
      setState({ status: "ready", just: true });
      window.dispatchEvent(new Event("picpac:ai-cached"));
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
          {state.just ? "Готово: ИИ скачан на это устройство" : "ИИ уже на этом устройстве"} — выделение, поиск предметов и ластик откроются без ожидания и работают без интернета.
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
            Выделение касанием, поиск предметов и ластик работают на устройстве; их модели — около {MB} МБ. Скачайте заранее, пока есть хорошая сеть — потом редактор работает и без интернета.
          </p>
          <button type="button" className="btn btn-small" onClick={start}>
            Скачать ИИ заранее ({MB} МБ)
          </button>
        </>
      )}
    </div>
  );
}
