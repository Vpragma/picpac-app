// Сервис-воркер PicPac (свой, без плагинов). Регистрирует его components/Pwa.js как /sw.js?v=<версия сборки>.
//
// Что и как кэшируем:
// - статика сборки (/_next/static: скрипты, стили, шрифт Jost), иконки, экраны запуска, логотип — сначала кэш
//   (у файлов сборки в имени хэш, кэш привязан к версии и чистится при обновлении);
// - страницы — сначала сеть, без сети — сохранённая копия или страница «Нет сети» (/offline.html).
//   Копию храним только у страниц без данных пользователя в разметке: главная, карточки, «Мои книги», редактор,
//   корзина (черновики и корзина гостя живут в IndexedDB/localStorage устройства, а не в HTML);
// - N5: оболочка при повторном входе — мгновенно: если у такой страницы есть копия ЭТОЙ ЖЕ версии сборки
//   (заголовок X-App-Version = версия воркера), отдаём её сразу и обновляем копию в фоне. Копию другой версии
//   не отдаём и не храним (её файлы /_next/static могли исчезнуть) — тогда как раньше: сначала сеть.
//   Новая версия на сервере → её номер записываем в кэш picpac-meta, components/Pwa.js регистрирует воркер новой
//   версии → тост «Есть новая версия — Обновить», как и раньше;
// - каталог (/api/v1/catalog, общий для всех) — показываем сохранённый и обновляем в фоне;
// - модели ИИ (/models/, /ort/) — сначала кэш, по запросу, переживают обновления версии;
// - всё остальное API (вход, корзина, заказы, проекты, фото) и чужие сайты (хранилище фото) — только сеть,
//   воркер их не трогает: ответы с данными пользователя никогда не попадают в кэш.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC = "picpac-static-" + VERSION;
const PAGES = "picpac-pages-" + VERSION;
const DATA = "picpac-data-" + VERSION;
const MODELS = "picpac-models-v1";
const META = "picpac-meta"; // N5: последняя версия сборки, которую видел воркер (ключ LATEST) — читает components/Pwa.js
const LATEST = "/__picpac/latest-version";
const OFFLINE = "/offline.html";
const SHELL = ["/", "/books", "/editor", "/cart", "/help"]; // /help — телефон поддержки доступен и без сети
const SHELL_ASSETS = [OFFLINE, "/manifest.webmanifest", "/logo.svg", "/icon.svg", "/favicon.ico", "/icons/icon-192.png", "/icons/icon-512.png"];
const NET_TIMEOUT = 4000;

const sameOrigin = (url) => url.origin === self.location.origin;
const isStatic = (p) =>
  p.startsWith("/_next/static/") || p.startsWith("/icons/") || p.startsWith("/splash/") || p.startsWith("/demo-gallery/") || /^\/(logo\.svg|icon\.svg|favicon\.ico|apple-icon\.png)$/.test(p);
const isModel = (p) => p.startsWith("/models/") || p.startsWith("/ort/");
const isShellPage = (p) => SHELL.includes(p) || p.startsWith("/product/");
const pageKey = (url) => url.origin + url.pathname; // /editor?project=… и /editor — одна копия

// Ссылки на файлы сборки из HTML страницы: чтобы оболочка открылась без сети целиком
function assetsOf(html) {
  return [...new Set(html.match(/\/_next\/static\/[^"'\s\\)]+/g) || [])];
}

async function put(cacheName, url) {
  const cache = await caches.open(cacheName);
  if (await cache.match(url)) return;
  const res = await fetch(url, { credentials: "same-origin" });
  if (res.ok && res.type === "basic") await cache.put(url, res);
}

// Версия сборки страницы (заголовок из next.config.mjs). Нет заголовка (старый сервер) — считаем своей версией.
const versionOf = (res) => res.headers.get("x-app-version") || VERSION;

// N5: запомнить версию с сервера, если она новее нашей, — Pwa.js при следующем запуске зарегистрирует новый воркер
async function noteVersion(res) {
  const v = versionOf(res);
  if (v === VERSION) return;
  const meta = await caches.open(META);
  await meta.put(LATEST, new Response(v, { headers: { "Content-Type": "text/plain" } }));
}

// N7 (C1, C2): куски, которые страница подгружает по требованию (у редактора — перетаскивание, «Правки», превью книги,
// анализ фото; ~60 КБ сжатого JS). Их адреса — строки "static/chunks/…" внутри файлов сборки страницы. Кладём их в кэш
// при установке воркера, пока есть сеть, — и у новой версии до «Обновить»: иначе без сети ChunkLoadError.
// Только один уровень: следующие (библиотеки ИИ, ~1,6 МБ) нужны лишь с моделями — их кэширует «Скачать ИИ заранее».
const LAZY_PAGES = ["/editor"];
const chunkRefs = (js) => (js.match(/static\/chunks\/[\w.~-]+\.(?:js|css)/g) || []).map((p) => "/_next/" + p);

async function cacheLazyChunks(assets) {
  const cache = await caches.open(STATIC);
  const found = new Set();
  for (const u of assets.filter((a) => a.endsWith(".js"))) {
    const hit = await cache.match(u);
    if (hit) for (const ref of chunkRefs(await hit.text())) if (!assets.includes(ref)) found.add(ref);
  }
  await Promise.allSettled([...found].slice(0, 60).map((u) => put(STATIC, u)));
}

// Скачать страницу оболочки в кэш (только своей версии) и её файлы сборки
async function cachePage(path) {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok || res.redirected) return;
  await noteVersion(res);
  if (versionOf(res) !== VERSION) return;
  const html = await res.clone().text();
  const pages = await caches.open(PAGES);
  await pages.put(new URL(path, self.location.origin).href, res);
  const assets = assetsOf(html);
  await Promise.allSettled(assets.map((u) => put(STATIC, u)));
  if (LAZY_PAGES.includes(path)) await cacheLazyChunks(assets).catch(() => {});
}

async function precache() {
  // Каталог (общий для всех) нужен редактору и карточкам без сети
  await Promise.allSettled([...SHELL_ASSETS.map((u) => put(STATIC, u)), put(DATA, "/api/v1/catalog")]);
  await Promise.allSettled(SHELL.map(cachePage));
}

// N5: тема или «Крупный текст» сменились (cookie) — перекачать сохранённые страницы, чтобы копия была в новом виде
async function refreshPages() {
  const pages = await caches.open(PAGES);
  const keys = await pages.keys();
  await Promise.allSettled(keys.map((req) => cachePage(new URL(req.url).pathname)));
}

self.addEventListener("install", (event) => {
  // Новая версия ждёт, пока пользователь нажмёт «Обновить» (сообщение SKIP_WAITING) — открытые вкладки не ломаются.
  // Самая первая установка активируется сразу (ждать некого).
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC, PAGES, DATA, MODELS, META];
      // Запись о «новой версии» — это мы: стираем (если на сервере уже ещё более новая — запись остаётся)
      const meta = await caches.open(META);
      const latest = await meta.match(LATEST);
      if (latest && (await latest.text()) === VERSION) await meta.delete(LATEST);
      for (const key of await caches.keys()) if (key.startsWith("picpac-") && !keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
  if (msg.type === "REFRESH_PAGES") event.waitUntil(refreshPages());
  // Страница присылает файлы, загруженные до того, как воркер начал её обслуживать (первый визит)
  if (msg.type === "CACHE_URLS" && Array.isArray(msg.urls)) {
    const urls = msg.urls
      .map((u) => {
        try {
          return new URL(u, self.location.origin);
        } catch {
          return null;
        }
      })
      .filter((u) => u && sameOrigin(u) && isStatic(u.pathname))
      .slice(0, 300);
    event.waitUntil(Promise.allSettled(urls.map((u) => put(STATIC, u.href))));
  }
});

// N7 (C6): тема приложения для страницы «Нет сети»: cookie pp_theme (Cookie Store API), иначе — атрибут сохранённой
// страницы (его ставит сервер по той же cookie). Не узнали — страница сама следует настройке телефона (prefers-color-scheme).
const THEMES = ["light", "dark", "system"];
async function currentTheme() {
  try {
    if (self.cookieStore) {
      const c = await self.cookieStore.get("pp_theme");
      return c && THEMES.includes(c.value) ? c.value : "light"; // нет cookie — светлая, как в приложении
    }
  } catch {
    // Cookie Store недоступен — смотрим сохранённые страницы
  }
  const pages = await caches.open(PAGES);
  for (const req of (await pages.keys()).slice(0, 3)) {
    const hit = await pages.match(req);
    const m = hit && (await hit.text()).slice(0, 2000).match(/data-color-scheme="(light|dark|system)"/);
    if (m) return m[1];
  }
  return null;
}

async function offlineResponse() {
  const hit = await caches.match(OFFLINE);
  if (!hit) return new Response("Нет сети. Черновики сохранены на устройстве — продолжите, когда связь вернётся.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const theme = await currentTheme().catch(() => null);
  if (!theme) return hit;
  const html = (await hit.text()).replace("<html lang=\"ru\">", `<html lang="ru" data-color-scheme="${theme}">`);
  const headers = new Headers(hit.headers);
  headers.delete("content-length");
  return new Response(html, { status: hit.status, statusText: hit.statusText, headers });
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") cache.put(request, res.clone());
  return res;
}

async function page(event, request, url) {
  const keep = isShellPage(url.pathname);
  const key = pageKey(url);
  let stored = null;
  const net = fetch(request).then((res) => {
    if (keep && res.ok && res.type === "basic" && !res.redirected) {
      // Храним только копию своей версии: её файлы сборки лежат в кэше этого воркера (работает и без сети).
      // Ответ не ждёт записи в кэш — HTML идёт в страницу потоком.
      const copy = versionOf(res) === VERSION ? res.clone() : null;
      stored = Promise.allSettled([noteVersion(res), copy && caches.open(PAGES).then((c) => c.put(key, copy))]);
    }
    return res;
  });
  // Воркер живёт, пока не дописана свежая копия (и в фоне после ответа из кэша)
  event.waitUntil(net.then(() => stored, () => null));
  const cache = await caches.open(PAGES);
  // N5: повторный вход — оболочка из кэша сразу (той же версии), свежая копия — в фоне для следующего раза
  const saved = keep && (await cache.match(key));
  if (saved && versionOf(saved) === VERSION) return saved;
  try {
    // Медленная сеть: через 4 с отдаём сохранённую копию, если она есть
    const first = await Promise.race([net, new Promise((r) => setTimeout(() => r(null), NET_TIMEOUT))]);
    if (first) return first;
    const hit = keep && (await cache.match(key));
    return hit || (await net);
  } catch {
    const hit = keep && (await cache.match(key));
    return hit || offlineResponse();
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const net = fetch(request)
    .then((res) => {
      if (res.ok && res.type === "basic") cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const res = await net;
  return res || Response.json({ ok: false, error: { code: "offline", message: "Нет сети. Попробуйте, когда связь вернётся." } }, { status: 503 });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (!sameOrigin(url)) return;
  const path = url.pathname;
  if (request.mode === "navigate") {
    event.respondWith(page(event, request, url));
    return;
  }
  // Данные страниц для переходов внутри приложения (RSC) — только сеть: без сети Next.js сам откроет страницу целиком
  if (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) return;
  if (path === "/api/v1/catalog") {
    event.respondWith(staleWhileRevalidate(request, DATA));
    return;
  }
  if (path.startsWith("/api/") || path === "/sw.js") return;
  if (isModel(path)) {
    event.respondWith(cacheFirst(request, MODELS));
    return;
  }
  if (isStatic(path)) {
    event.respondWith(cacheFirst(request, STATIC));
    return;
  }
  if (path === "/manifest.webmanifest" || path === OFFLINE) event.respondWith(staleWhileRevalidate(request, STATIC));
});

// ---------- Пуши (D5) ----------
// В пуше нет персональных данных: заголовок, короткий текст, путь своего экрана, тег.
// Уведомление показываем всегда, даже если данные не разобрались: Safari/iOS отзывает подписку,
// если пуш пришёл, а уведомления не было.
function ownPath(u) {
  try {
    const x = new URL(u || "/", self.location.origin);
    return x.origin === self.location.origin ? x.pathname + x.search + x.hash : "/";
  } catch {
    return "/";
  }
}

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = {};
  }
  event.waitUntil(
    self.registration.showNotification(String(d.title || "PicPac").slice(0, 60), {
      body: String(d.body || "Есть новости в приложении PicPac").slice(0, 140),
      // N2: сезонная иконка — только свои файлы /icons/season/ (сервер кладёт путь в пуш по текущему сезону)
      icon: /^\/icons\/season\/icon-(autumn|blackfriday|newyear)-192\.png$/.test(d.icon || "") ? d.icon : "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag ? String(d.tag).slice(0, 32) : undefined, // одинаковый тег заменяет прошлое уведомление
      lang: "ru",
      data: { url: ownPath(d.url) },
    }),
  );
});

// Нажатие на уведомление: открытая вкладка переходит на экран, иначе открываем приложение (deep link)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(ownPath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (!w.url.startsWith(self.location.origin)) continue;
        await w.focus().catch(() => {});
        if ("navigate" in w && (await w.navigate(target).catch(() => null))) return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
