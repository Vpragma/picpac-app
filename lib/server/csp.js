// Content-Security-Policy с nonce (новый на каждый запрос страницы, ставит proxy.js).
// Скрипты — только свои с nonce и подгруженные ими ('strict-dynamic'); wasm моделей — 'wasm-unsafe-eval';
// воркеры редактора и печати — свои и blob:; фото и загрузка — свой сайт и хранилище Supabase.
// Стили: React рисует атрибуты style="…", их nonce не разрешает — поэтому 'unsafe-inline' только для стилей.
// preview: на превью Vercel встраивает свою панель (vercel.live, рамка и запросы) — разрешаем её только там.
export function buildCsp(nonce, { dev = false, https = false, supabase = "", preview = false } = {}) {
  const sb = supabase ? new URL(supabase).origin : "";
  const vl = preview ? " https://vercel.live" : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sb ? " " + sb : ""}${preview ? " https://vercel.live https://vercel.com" : ""}`,
    `font-src 'self'${preview ? " https://vercel.live https://assets.vercel.com" : ""}`,
    `connect-src 'self' data: blob:${sb ? " " + sb : ""}${dev ? " ws:" : ""}${preview ? " https://vercel.live wss://ws-us3.pusher.com" : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `frame-src ${preview ? "https://vercel.live" : "'none'"}`,
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function newNonce() {
  return btoa(crypto.randomUUID());
}
