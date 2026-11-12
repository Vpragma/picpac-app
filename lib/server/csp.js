// Content-Security-Policy с nonce (новый на каждый запрос страницы, ставит proxy.js).
// Скрипты — только свои с nonce и подгруженные ими ('strict-dynamic'); wasm моделей — 'wasm-unsafe-eval';
// воркеры редактора и печати — свои и blob:; фото и загрузка — свой сайт и хранилище Supabase.
// Стили: React рисует атрибуты style="…", их nonce не разрешает — поэтому 'unsafe-inline' только для стилей.
export function buildCsp(nonce, { dev = false, https = false, supabase = "" } = {}) {
  const sb = supabase ? new URL(supabase).origin : "";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sb ? " " + sb : ""}`,
    "font-src 'self'",
    `connect-src 'self' data: blob:${sb ? " " + sb : ""}${dev ? " ws:" : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ];
  if (https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export function newNonce() {
  return btoa(crypto.randomUUID());
}
