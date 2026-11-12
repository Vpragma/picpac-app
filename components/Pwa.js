"use client";
// Приложение (PWA): регистрация сервис-воркера (public/sw.js), тост «Есть новая версия», плашка «Нет сети»
// со счётчиком фото, которые ждут загрузки, и кнопка «Установить приложение» (Android, компьютер) / инструкция для iPhone.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { pendingPhotoCount, useSyncState } from "../lib/sync";

// --- Сеть есть или нет (события online/offline) ---
function subscribeOnline(cb) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine !== false, () => true);
}

// --- Установка: событие beforeinstallprompt ловим один раз на всё приложение ---
let installEvent = null;
let installed = false;
const installListeners = new Set();
const emitInstall = () => installListeners.forEach((l) => l());
function subscribeInstall(cb) {
  installListeners.add(cb);
  return () => installListeners.delete(cb);
}
// "prompt" — можно показать системное окно; "ios" — iPhone/iPad без установки; "android" — Android, браузер окно
// не предложил (ещё не готов сервис-воркер или другой браузер); "installed" — уже открыто как приложение; null — не поддерживается.
// N7: инструкция выбирается по устройству из строки браузера. Android проверяем первым: эмуляция Android на Mac
// (встроенный браузер, DevTools) сообщает платформу MacIntel с сенсорным экраном — раньше это принималось за iPad.
function installState() {
  if (installed) return "installed";
  if (typeof window === "undefined") return null;
  if (window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone) return "installed";
  if (installEvent) return "prompt";
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "android";
  // iPad в режиме «как на компьютере» пишет в строке браузера Macintosh, но у него сенсорный экран
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios ? "ios" : null;
}
export function useInstall() {
  const state = useSyncExternalStore(subscribeInstall, installState, () => null);
  const install = async () => {
    const e = installEvent;
    if (!e) return false;
    installEvent = null;
    e.prompt();
    const choice = await e.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") installed = true;
    emitInstall();
    return choice?.outcome === "accepted";
  };
  return { state, install };
}

// Карточка в профиле: не навязываем — только кнопка или подсказка для iPhone
export function InstallCard() {
  const { state, install } = useInstall();
  if (!state) return null;
  if (state === "installed") return <p className="muted pwa-install-note">PicPac установлен как приложение на этом устройстве.</p>;
  return (
    <section className="card pwa-install" aria-labelledby="pwa-install-title">
      <h2 id="pwa-install-title">Приложение PicPac</h2>
      {state === "prompt" ? (
        <>
          <p className="muted">Значок на экране, открывается без браузера, черновики доступны без сети.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={install}>
            Установить приложение
          </button>
        </>
      ) : state === "android" ? (
        <ol className="pwa-ios-steps" data-install="android">
          <li>
            Откройте меню браузера <span aria-hidden="true">(три точки справа вверху)</span>.
          </li>
          <li>Выберите «Установить приложение» или «Добавить на главный экран».</li>
          <li>Подтвердите — значок PicPac появится на экране.</li>
        </ol>
      ) : (
        <ol className="pwa-ios-steps" data-install="ios">
          <li>
            Нажмите «Поделиться» <span aria-hidden="true">(квадрат со стрелкой вверх)</span> внизу Safari.
          </li>
          <li>Выберите «На экран „Домой“».</li>
          <li>Нажмите «Добавить» — значок PicPac появится на экране.</li>
        </ol>
      )}
    </section>
  );
}

export default function Pwa() {
  const [waiting, setWaiting] = useState(null);
  const wantReload = useRef(false);
  const online = useOnline();
  useSyncState(); // перерисовка при изменении очереди загрузки
  const pending = pendingPhotoCount();

  useEffect(() => {
    const onPrompt = (e) => {
      e.preventDefault();
      installEvent = e;
      emitInstall();
    };
    const onInstalled = () => {
      installed = true;
      installEvent = null;
      emitInstall();
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    // В режиме разработки воркер мешал бы горячей перезагрузке
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    const sw = navigator.serviceWorker;
    const onController = () => {
      // Перезагружаем только по кнопке «Обновить» (первая установка тоже меняет controller — её не трогаем)
      if (wantReload.current) window.location.reload();
    };
    sw.addEventListener("controllerchange", onController);
    // Регистрируем после загрузки страницы и в простое: предзагрузка оболочки не спорит за сеть с первым показом
    const version = process.env.NEXT_PUBLIC_APP_VERSION || "dev";
    let idleId = null;
    const start = () => {
      idleId = "requestIdleCallback" in window ? window.requestIdleCallback(register, { timeout: 4000 }) : window.setTimeout(register, 1500);
    };
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });
    return () => {
      sw.removeEventListener("controllerchange", onController);
      window.removeEventListener("load", start);
      if (idleId === null) return;
      if ("cancelIdleCallback" in window) window.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
    function register() {
    sw.register("/sw.js?v=" + encodeURIComponent(version), { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        const track = (w) =>
          w?.addEventListener("statechange", () => {
            if (w.state === "installed" && sw.controller) setWaiting(w);
          });
        if (reg.waiting && sw.controller) setWaiting(reg.waiting);
        track(reg.installing);
        reg.addEventListener("updatefound", () => track(reg.installing));
        return sw.ready;
      })
      .then((reg) => {
        // Файлы этой страницы, загруженные до того, как воркер начал её обслуживать (первый визит)
        const urls = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((u) => u.startsWith(window.location.origin + "/_next/static/"));
        reg?.active?.postMessage({ type: "CACHE_URLS", urls });
      })
      .catch((e) => console.warn("Сервис-воркер не зарегистрирован:", e?.message || e));
    }
  }, []);

  const update = () => {
    wantReload.current = true;
    waiting?.postMessage({ type: "SKIP_WAITING" });
    setWaiting(null);
  };

  return (
    <>
      {!online && (
        <div className="net-banner" role="status">
          <b>Нет сети</b> — черновики сохраняются на устройстве.
          {pending > 0 && <span className="net-banner-queue"> Фото загрузятся, когда появится связь: {pending}</span>}
        </div>
      )}
      {waiting && (
        <div className="toast pwa-update" role="status">
          <span>Есть новая версия</span>
          <button type="button" className="btn btn-small btn-primary" onClick={update}>
            Обновить
          </button>
        </div>
      )}
    </>
  );
}
