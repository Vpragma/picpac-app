const nextConfig = {
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
    ];
  },
};

export default nextConfig;
