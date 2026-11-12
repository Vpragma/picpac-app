// Сервис-воркер PicPac (свой, без плагинов). Регистрирует его components/Pwa.js как /sw.js?v=<версия сборки>.
//
// Что и как кэшируем:
// - статика сборки (/_next/static: скрипты, стили, шрифт Jost), иконки, экраны запуска, логотип — сначала кэш
//   (у файлов сборки в имени хэш, кэш привязан к версии и чистится при обновлении);
// - страницы — сначала сеть, без сети — сохранённая копия или страница «Нет сети» (/offline.html).
//   Копию храним только у страниц без данных пользователя в разметке: главная, карточки, «Мои книги», редактор,
//   корзина (черновики и корзина гостя живут в IndexedDB/localStorage устройства, а не в HTML);
// - каталог (/api/v1/catalog, общий для всех) — показываем сохранённый и обновляем в фоне;
// - модели ИИ (/models/, /ort/) — сначала кэш, по запросу, переживают обновления версии;
// - всё остальное API (вход, корзина, заказы, проекты, фото) и чужие сайты (хранилище фото) — только сеть,
//   воркер их не трогает: ответы с данными пользователя никогда не попадают в кэш.
const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const STATIC = "picpac-static-" + VERSION;
const PAGES = "picpac-pages-" + VERSION;
const DATA = "picpac-data-" + VERSION;
const MODELS = "picpac-models-v1";
const OFFLINE = "/offline.html";
const SHELL = ["/", "/books", "/editor", "/cart"];
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

async function precache() {
  const pages = await caches.open(PAGES);
  // Каталог (общий для всех) нужен редактору и карточкам без сети
  await Promise.allSettled([...SHELL_ASSETS.map((u) => put(STATIC, u)), put(DATA, "/api/v1/catalog")]);
  await Promise.allSettled(
    SHELL.map(async (path) => {
      const res = await fetch(path, { credentials: "same-origin" });
      if (!res.ok || res.redirected) return;
      const html = await res.clone().text();
      await pages.put(new URL(path, self.location.origin).href, res);
      await Promise.allSettled(assetsOf(html).map((u) => put(STATIC, u)));
    }),
  );
}

self.addEventListener("install", (event) => {
  // Новая версия ждёт, пока пользователь нажмёт «Обновить» (сообщение SKIP_WAITING) — открытые вкладки не ломаются.
  // Самая первая установка активируется сразу (ждать некого).
  event.waitUntil(precache());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC, PAGES, DATA, MODELS];
      for (const key of await caches.keys()) if (key.startsWith("picpac-") && !keep.includes(key)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  if (msg.type === "SKIP_WAITING") self.skipWaiting();
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

function offlineResponse() {
  return caches.match(OFFLINE).then(
    (hit) => hit || new Response("Нет сети. Черновики сохранены на устройстве — продолжите, когда связь вернётся.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") cache.put(request, res.clone());
  return res;
}

async function page(request, url) {
  const keep = isShellPage(url.pathname);
  const cache = await caches.open(PAGES);
  const key = pageKey(url);
  const net = fetch(request).then((res) => {
    if (keep && res.ok && res.type === "basic" && !res.redirected) cache.put(key, res.clone());
    return res;
  });
  net.catch(() => {});
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
    event.respondWith(page(request, url));
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
      icon: "/icons/icon-192.png",
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
