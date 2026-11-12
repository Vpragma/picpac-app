import { execSync } from "node:child_process";

// Версия сборки для сервис-воркера (/sw.js?v=…): коммит на Vercel, локально — текущий коммит git
function buildVersion() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8);
  try {
    return execSync("git rev-parse --short=8 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

const dev = process.env.NODE_ENV === "development";
// Политика CSP воркеров: никаких внешних адресов, eval — только для компиляции wasm
const WORKER_CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' blob: data:; worker-src 'self'; object-src 'none'";

const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: buildVersion() },
  // Без заголовка X-Powered-By: Next.js (SEC-10)
  poweredByHeader: false,
  // ИИ-редактор (D1): один onnxruntime-web 1.31.1 для transformers.js (SlimSAM) и ластика MI-GAN.
  // Без этого Turbopack кладёт в сборку две копии ORT и два .wasm (14,8 и 26,9 МБ); wasm берётся из public/ort.
  turbopack: {
    resolveAlias: {
      "onnxruntime-web/webgpu": "./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs",
    },
  },
  experimental: {
    // Страницы 401 и 403 (app/unauthorized.js, app/forbidden.js) для отказа в доступе
    authInterrupts: true,
  },
  // Модерация на сервере (N4, lib/server/moderationEngine.js): onnxruntime-web в Node (wasm, без нативных библиотек)
  // подключается как обычный пакет; в функции, которые проверяют фото, кладутся его .wasm и загрузчик и модели
  // public/models/moderation (≈ 112 МБ; функция ≈ 150 МБ при лимите Vercel 250 МБ) — сеть для моделей не нужна.
  serverExternalPackages: ["onnxruntime-web"],
  outputFileTracingIncludes: Object.fromEntries(
    ["/api/v1/orders", "/api/v1/projects/*/photos", "/api/v1/projects/*/photos/*/print", "/api/v1/moderation/health"].map((route) => [
      route,
      ["./node_modules/onnxruntime-web/dist/ort.node.min.mjs", "./node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.{mjs,wasm}", "./public/models/moderation/*.{onnx,json}"],
    ]),
  ),
  // Защитные заголовки для всех страниц
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
      // Воркеры (ИИ-редактор, ластик, резкость, печать, анализ фото): у воркера своя политика CSP из ответа на его
      // скрипт — только свой сайт: код, wasm моделей ('wasm-unsafe-eval') и запросы только к себе (модели из /models,
      // /ort). Все воркеры Turbopack стартуют с файла turbopack-worker-*.js. В `next dev` не ставим (там свой eval).
      ...(dev
        ? []
        : [
            {
              source: "/_next/static/chunks/turbopack-worker-:file",
              headers: [{ key: "Content-Security-Policy", value: WORKER_CSP }],
            },
          ]),
      // Модели ИИ и wasm (public/models, public/ort): пути версионированы папкой — браузер может долго не сверять
      {
        source: "/models/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      {
        source: "/ort/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=604800" }],
      },
      // Сервис-воркер: браузер всегда сверяет свежую версию; свой строгий CSP — только свой сайт
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
