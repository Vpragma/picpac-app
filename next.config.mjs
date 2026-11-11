const nextConfig = {
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
        ],
      },
    ];
  },
};

export default nextConfig;
