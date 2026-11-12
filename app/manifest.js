// Манифест приложения (PWA): Next.js 16 отдаёт его по адресу /manifest.webmanifest и сам ставит <link rel="manifest">.
// Цвета — из токенов picpac.css: фон страницы --ds-color-bg-page (#faf5ed). Иконки — scripts/make-icons.mjs из public/logo.svg.
export default function manifest() {
  return {
    id: "/",
    name: "PicPac — фотокниги",
    short_name: "PicPac",
    description: "Фотокниги и печать фото PicPac: цена видна сразу, печатаем за 2–3 дня.",
    lang: "ru",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#faf5ed",
    theme_color: "#faf5ed",
    categories: ["photo", "shopping"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Мои книги", short_name: "Книги", url: "/books", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Корзина", url: "/cart", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Заказы", url: "/orders", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
