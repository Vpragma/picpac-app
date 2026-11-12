// Обход ошибки старых Chrome (проверено на Chrome 111): Turbopack запускает все воркеры через один и тот же
// файл turbopack-worker-*.js и передаёт список кусков кода во фрагменте адреса (#params=…). Старый Chrome берёт
// такой файл из кэша вместе с адресом ПЕРВОГО воркера — и второй воркер (ИИ, печать) молча запускает код первого
// (анализ фото). Загрузчик Turbopack понимает и ?params=…: переносим параметры из фрагмента в запрос —
// адреса воркеров становятся разными, и каждый получает свой код. Подключается модулями, которые создают воркеры.
const MARK = "__picpacWorkerShim";

function fixUrl(u) {
  const s = String(u);
  const i = s.indexOf("#params=");
  if (i < 0 || !s.includes("turbopack-worker")) return u;
  const params = decodeURIComponent(s.slice(i + 8));
  return s.slice(0, i) + (s.includes("?") ? "&" : "?") + "params=" + encodeURIComponent(params);
}

if (typeof window !== "undefined" && typeof window.Worker === "function" && !window[MARK]) {
  const Native = window.Worker;
  window[MARK] = true;
  window.Worker = class PicpacWorker extends Native {
    constructor(url, options) {
      super(fixUrl(url instanceof URL ? url.href : url), options);
    }
  };
}

export { fixUrl };
