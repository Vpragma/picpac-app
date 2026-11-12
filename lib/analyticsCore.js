// Аналитика: общие названия событий и расчёты дашборда. Чистые функции — их проверяет unit-тест.

// События, которые присылает браузер (POST /api/v1/events). order_created и payment_test пишет только сервер.
export const CLIENT_EVENTS = ["product_view", "project_create", "photo_upload", "editor_step", "ai_edit", "cart_add", "checkout_start"];
export const SERVER_EVENTS = ["order_created", "payment_test"];
export const EDITOR_STEPS = ["photos", "layout", "edits", "check"];
export const STEP_LABELS = { photos: "Фото", layout: "Раскладка", edits: "Правки", check: "Проверка" };

export const FUNNEL = [
  { key: "product_view", label: "Просмотр продукта", formula: "Разные участники с событием «просмотр продукта» за период" },
  { key: "project_create", label: "Создан проект", formula: "Разные участники с событием «создан проект» за период" },
  { key: "cart_add", label: "Добавили в корзину", formula: "Разные участники с событием «добавлено в корзину» за период" },
  { key: "checkout_start", label: "Начали оформление", formula: "Разные участники, нажавшие «Подтвердить заказ», за период" },
  { key: "payment_test", label: "Оплачено (тест)", formula: "Разные участники с тестовой оплатой заказа (событие пишет сервер в момент оплаты) за период" },
];

// Медиана массива чисел (пустой массив — null)
export function median(values) {
  const a = (values || []).filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// Доля в процентах с одним знаком; при нулевом знаменателе — null
export function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

// Воронка: шаги с числом участников, конверсией от предыдущего шага и от первого
export function buildFunnel(counts = {}) {
  const steps = FUNNEL.map((s, i) => {
    const n = Number(counts[s.key]) || 0;
    const prev = i ? Number(counts[FUNNEL[i - 1].key]) || 0 : null;
    return { ...s, n, fromPrev: i ? pct(n, prev) : null, fromFirst: pct(n, Number(counts[FUNNEL[0].key]) || 0) };
  });
  const cart = Number(counts.cart_add) || 0;
  const paid = Number(counts.payment_test) || 0;
  return { steps, cartToPaid: pct(paid, cart) };
}

// Время на шагах редактора: медиана в секундах и число замеров; где чаще бросают — доля последнего шага
export function buildSteps(durations = {}, dropoff = {}) {
  const totalDrop = EDITOR_STEPS.reduce((s, k) => s + (Number(dropoff[k]) || 0), 0);
  const rows = EDITOR_STEPS.map((k) => {
    const med = median(durations[k] || []);
    return {
      key: k,
      label: STEP_LABELS[k],
      medianSec: med == null ? null : Math.round(med / 1000),
      samples: (durations[k] || []).length,
      dropped: Number(dropoff[k]) || 0,
      dropShare: pct(Number(dropoff[k]) || 0, totalDrop),
    };
  });
  const worst = totalDrop ? rows.reduce((a, b) => (b.dropped > a.dropped ? b : a)) : null;
  return { rows, worst, totalDrop };
}

// Время «1 мин 35 с»
export function fmtDuration(sec) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m} мин ${s} с` : `${s} с`;
}

// Подпись источника данных
export function sourceLabel(summary) {
  const synth = (summary?.synthetic?.events || 0) + (summary?.synthetic?.orders || 0);
  return synth > 0 ? "демо-данные" : "реальные";
}
