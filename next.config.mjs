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

const nextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: buildVersion() },
  // Без заголовка X-Powered-By: Next.js (SEC-10)
  poweredByHeader: false,
  experimental: {
    // Страницы 401 и 403 (app/unauthorized.js, app/forbidden.js) для отказа в доступе
    authInterrupts: true,
  },
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
