import { Jost } from "next/font/google";
import { cookies, headers } from "next/headers";
import { getImageProps } from "next/image";
import "./picpac.css";
import "./globals.css";
import "./ux.css";
import "./qr.css";
import "./brand.css";
import { qrSvg, siteUrl } from "@/lib/server/qr";
import Shell from "../components/Shell";
import { THEME_COLORS, THEME_COOKIE, parseTheme } from "@/lib/themeShared";

// Jost — свои файлы с нашего сайта (next/font скачивает их при сборке, к Google в работе сайта запросов нет):
// подмножества латиница + кириллица (один переменный файл на подмножество — и 400, и 500), font-display: swap.
// N5: preload — браузер качает оба файла сразу вместе с HTML, а не после разбора CSS (заголовок первого экрана —
// LCP — не ждёт смены шрифта).
const jost = Jost({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  preload: true,
  variable: "--font-jost",
  display: "swap",
});

// Экраны запуска iOS (scripts/make-icons.mjs): [ширина, высота, плотность] в CSS-пикселях устройства
const SPLASH = [
  [430, 932, 3, "1290x2796"],
  [393, 852, 3, "1179x2556"],
  [428, 926, 3, "1284x2778"],
  [390, 844, 3, "1170x2532"],
  [375, 812, 3, "1125x2436"],
  [414, 896, 2, "828x1792"],
  [375, 667, 2, "750x1334"],
];

export const metadata = {
  title: "PicPac — фотокниги и печать фото",
  description: "Фотокниги и печать фото PicPac: цена видна сразу, печатаем за 2–3 дня.",
  applicationName: "PicPac",
  // Установка на iPhone («На экран Домой»): заголовок, строка статуса, экраны запуска
  appleWebApp: {
    capable: true,
    title: "PicPac",
    statusBarStyle: "default",
    startupImage: SPLASH.map(([w, h, r, file]) => ({
      url: `/splash/apple-splash-${file}.png`,
      media: `(device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: portrait)`,
    })),
  },
  formatDetection: { telephone: false },
  // Старые iOS (до 16.4) понимают только apple-mobile-web-app-capable
  other: { "apple-mobile-web-app-capable": "yes" },
};

// Цвет строки состояния — по выбранной теме (N1): светлая по умолчанию, «как в системе» — оба варианта с media
export async function generateViewport() {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor:
      theme === "system"
        ? [
            { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
            { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
          ]
        : THEME_COLORS[theme],
  };
}

// Чтение заголовков делает страницы динамическими: каждая получает свой nonce из CSP (proxy.js).
// Без этого страницы ISR отдавались бы со скриптами без nonce, и строгая CSP их заблокировала бы.
// Режим «Крупный текст» (D2): cookie pp_text=lg → атрибут на <html> ставит сервер — без мигания и без встроенного скрипта (строгая CSP).
export default async function RootLayout({ children }) {
  await headers();
  const jar = await cookies();
  const largeText = jar.get("pp_text")?.value === "lg";
  // Тема (N1): светлая по умолчанию у всех, независимо от настройки телефона; выбор — в профиле (cookie pp_theme)
  const theme = parseTheme(jar.get(THEME_COOKIE)?.value);
  // Логотип через next/image (getImageProps): на сервере, без клиентского JS; SVG отдаётся как есть
  const { props: logo } = getImageProps({ src: "/logo.svg", alt: "PicPac", width: 72, height: 40, loading: "eager" });
  // D9: «Открыть на телефоне» — небольшой QR на адрес этого сайта (рисует сервер; виден только на компьютере)
  const phoneSvg = await qrSvg(await siteUrl(), { margin: 1 });
  return (
    <html lang="ru" data-theme="picpac" data-color-scheme={theme} data-text={largeText ? "lg" : undefined} className={jost.variable}>
      <body>
        <Shell
          logo={
            <picture>
              <img {...logo} alt="PicPac" />
            </picture>
          }
          phoneQr={
            phoneSvg ? (
              <a href="/qr" className="phone-qr">
                <span className="phone-qr-code" aria-hidden="true" dangerouslySetInnerHTML={{ __html: phoneSvg }} />
                <span>
                  <strong>Открыть на телефоне</strong>
                  <br />
                  Наведите камеру на код
                </span>
              </a>
            ) : null
          }
        >
          {children}
        </Shell>
      </body>
    </html>
  );
}
