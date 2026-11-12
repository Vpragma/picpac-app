// Правила уведомлений (D5): тихие часы, кому напомнить о забытой корзине, ключ корзины, тексты.
// Чистые функции без базы и сети — их проверяют unit-тесты (tests/unit/notify-rules.test.mjs).

// Минуты от полуночи в часовом поясе (Минск — UTC+3 круглый год)
export function minutesIn(date, tz = "Europe/Minsk") {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  return Number(p.find((x) => x.type === "hour").value) * 60 + Number(p.find((x) => x.type === "minute").value);
}

const toMin = (t) => {
  const [h, m] = String(t || "0:0")
    .split(":")
    .map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Тихие часы: по умолчанию 22:00–09:00 по Минску. time из Postgres приходит как "22:00:00" — тоже подходит
export function isQuietHours(date, from = "22:00", to = "09:00", tz = "Europe/Minsk") {
  let now;
  try {
    now = minutesIn(date, tz || "Europe/Minsk");
  } catch {
    now = minutesIn(date, "Europe/Minsk"); // неизвестный пояс в настройках — считаем по Минску
  }
  const a = toMin(from || "22:00");
  const b = toMin(to || "09:00");
  if (a === b) return false;
  return a < b ? now >= a && now < b : now >= a || now < b;
}

// Ключ корзины — отсортированные id проектов. Изменился состав — это новая корзина (и новое напоминание)
export function cartKeySource(projectIds) {
  return [...new Set(projectIds)].sort().join(",");
}

// rows: cart_items с projects(title, product_slug, status, updated_at); settings: Map(user_id → notification_settings)
// → { ready, quiet }: ready — напомнить сейчас, quiet — подождут утра (тихие часы пользователя)
export function dueCarts(rows, settings, { now = new Date(), afterMin = 1440 } = {}) {
  const users = new Map();
  for (const r of rows || []) {
    const p = r.projects;
    if (!p || p.status === "ordered") continue;
    const u = users.get(r.user_id) || { userId: r.user_id, ids: [], last: 0, title: "", product: "" };
    u.ids.push(r.project_id);
    const t = Math.max(Date.parse(r.updated_at) || 0, Date.parse(p.updated_at) || 0);
    if (t >= u.last) Object.assign(u, { last: t, title: p.title || "", product: p.product_slug || "" });
    users.set(r.user_id, u);
  }
  const ready = [];
  const quiet = [];
  for (const u of users.values()) {
    const s = settings.get(u.userId) || {};
    if (s.reminders === false || now - u.last < afterMin * 60_000) continue;
    (isQuietHours(now, s.quiet_from, s.quiet_to, s.timezone) ? quiet : ready).push(u);
  }
  return { ready, quiet };
}

// Тексты (тёплые, без давления): в приложении — с названием книги, в пуше — только продукт
// (название вводит пользователь, а пуш виден на заблокированном экране)
export function cartReminderText({ title, productName }) {
  const product = productName || "фотокнига";
  return {
    inbox: { title: "Книга ждёт в корзине", body: `Ваша книга «${String(title || product).slice(0, 80)}» ждёт в корзине. Вернуться?` },
    push: { title: "PicPac", body: `Ваша ${product} ждёт в корзине. Вернуться?`, url: "/cart", tag: "cart" },
  };
}

// Какие уведомления центра дублировать пушем: только важное (без «принят» и подэтапов производства —
// симулятор ERP двигает статусы часто, пуши посыпались бы пачкой)
export const PUSH_KINDS = ["order_shipped", "order_done", "support_reply", "photo_replace", "moderation_replace", "cart_reminder"];

// ---------- Пуши: адрес подписки, метка устройства, содержимое ----------
// Chrome/Edge/Opera — FCM, Firefox — Mozilla, Windows — WNS, Safari/iOS — Apple
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/, /(^|\.)push\.apple\.com$/];

export function allowedEndpoint(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && !x.port && !x.username && !x.password && PUSH_HOSTS.some((re) => re.test(x.hostname));
  } catch {
    return false;
  }
}

// Короткая метка устройства вместо полного User-Agent (минимум данных, SEC-19)
export function deviceLabel(ua = "") {
  const os = /iPhone|iPad|iPod/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "другое";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "браузер";
  return `${os} · ${br}`;
}

// Свой путь экрана или «/»: чужой адрес в пуш не попадает
const ownPath = (u) => (typeof u === "string" && /^\/[A-Za-z0-9]/.test(u) && !u.startsWith("//") ? u.slice(0, 200) : "/");

export function pushPayload({ title, body, url, tag }) {
  return JSON.stringify({
    title: String(title || "PicPac").slice(0, 60),
    body: String(body || "").slice(0, 140),
    url: ownPath(url),
    tag: tag ? String(tag).slice(0, 32) : undefined,
  });
}


// ---------- D9: результат отправки, демо-пуши (шаблоны), текст «под кнопкой» ----------
// Ответ push-сервиса → что делать с подпиской. 201/200/202 — принято; 404/410 — подписка умерла, удалить
export function pushOutcome(status) {
  const s = Number(status) || 0;
  return { ok: s >= 200 && s < 300, remove: s === 404 || s === 410, status: s };
}

// Хост push-сервиса → понятное имя (для текста «Принято сервисом Apple…»)
export function pushServiceName(host = "") {
  if (/(^|\.)push\.apple\.com$/.test(host)) return "Apple";
  if (/^fcm\.googleapis\.com$/.test(host)) return "Google";
  if (/mozilla\.com$/.test(host)) return "Mozilla";
  if (/notify\.windows\.com$/.test(host)) return "Microsoft";
  return "push";
}

// Демо-пуши (только шаблоны, произвольного текста от админа нет)
export const DEMO_ACTIONS = ["test", "cart", "advance"];
export const NEXT_STATUS = { accepted: "production", moderation: "production", production: "shipped", shipped: "done" };

export function demoPushText(kind, { products = [], number = "", orderId = "", status = "" } = {}) {
  if (kind === "test") return { title: "PicPac: уведомления работают", body: "Так будут приходить новости о заказах и корзине.", url: "/profile", tag: "test" };
  if (kind === "cart") {
    const first = String(products[0] || "фотокнига").slice(0, 60);
    const more = products.length > 1 ? ` и ещё ${products.length - 1}` : "";
    return { title: "PicPac", body: `В корзине: ${first}${more}. Оформим?`, url: "/cart", tag: "cart" };
  }
  const what = { production: "передан в производство", shipped: "готов и передан в доставку", done: "доставлен" }[status] || "изменил статус";
  return { title: "PicPac", body: `Заказ №${String(number).slice(0, 20)} ${what}`, url: orderId ? `/orders/${orderId}` : "/orders", tag: "order" };
}

// results: [{ service, ok, status }] → «Принято сервисом Apple: 1 из 1 устройств»
export function pushResultText(results, { noVapid = false } = {}) {
  if (noVapid) return "На сервере не настроены ключи уведомлений (VAPID) — пуш не отправлен.";
  if (!results?.length) return "Нет подписанных устройств — включите уведомления в профиле на телефоне.";
  const by = new Map();
  for (const r of results) {
    const x = by.get(r.service) || { ok: 0, all: 0, codes: [] };
    x.all++;
    if (r.ok) x.ok++;
    else x.codes.push(r.status || "сеть");
    by.set(r.service, x);
  }
  return [...by]
    .map(([s, x]) => `${x.ok ? "Принято" : "Не принято"} сервисом ${s}: ${x.ok} из ${x.all} ${x.all === 1 ? "устройства" : "устройств"}` + (x.codes.length ? ` (ошибка ${[...new Set(x.codes)].join(", ")})` : ""))
    .join("; ");
}
