import { Jost } from "next/font/google";
import "./picpac.css";
import "./globals.css";
import Shell from "../components/Shell";

const jost = Jost({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500"],
  variable: "--font-jost",
  display: "swap",
});

export const metadata = {
  title: "PicPac — фотокниги и печать фото",
  description: "Фотокниги и печать фото PicPac: цена видна сразу, печатаем за 2–3 дня.",
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

export default function RootLayout({ children }) {
  return (
    <html lang="ru" data-theme="picpac" className={jost.variable}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
