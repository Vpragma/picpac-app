import { Jost } from "next/font/google";
import { headers } from "next/headers";
import "./picpac.css";
import "./globals.css";
import Shell from "../components/Shell";

const jost = Jost({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
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

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf5ed" },
    { media: "(prefers-color-scheme: dark)", color: "#15100e" },
  ],
};

// Чтение заголовков делает страницы динамическими: каждая получает свой nonce из CSP (proxy.js).
// Без этого страницы ISR отдавались бы со скриптами без nonce, и строгая CSP их заблокировала бы.
export default async function RootLayout({ children }) {
  await headers();
  return (
    <html lang="ru" data-theme="picpac" className={jost.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
