// Фото коллажа сезонного баннера (N2) — из тестовой галереи (свободные лицензии, авторы — на странице «Лицензии и авторы»).
// Собираются на сервере (getImageProps): размеры известны заранее (без сдвигов макета), все — лениво (баннер ниже первого экрана,
// LCP главной не меняется). В браузер уходят только готовые атрибуты <img>.
import { getImageProps } from "next/image";
import autumnForest from "@/public/demo-gallery/autumn-forest.jpg";
import braslav from "@/public/demo-gallery/braslav-lake.jpg";
import cat from "@/public/demo-gallery/cat.jpg";
import winter from "@/public/demo-gallery/winter-field.jpg";
import night from "@/public/demo-gallery/night-street.jpg";

const SETS = {
  autumn: [
    { cls: "sb-print-a", src: autumnForest, sizes: "(min-width: 1024px) 270px, 54vw" },
    { cls: "sb-print-b", src: braslav, sizes: "(min-width: 1024px) 160px, 32vw" },
    { cls: "sb-print-c", src: cat, sizes: "(min-width: 1024px) 200px, 42vw" },
  ],
  blackfriday: [],
  newyear: [
    { cls: "sb-print-a", src: winter, sizes: "(min-width: 1024px) 280px, 56vw" },
    { cls: "sb-print-c", src: night, sizes: "(min-width: 1024px) 240px, 48vw" },
  ],
};

export function seasonPhotos() {
  return Object.fromEntries(
    Object.entries(SETS).map(([season, list]) => [
      season,
      list.map(({ cls, src, sizes }) => ({ cls, img: getImageProps({ src, alt: "", sizes, quality: 70, loading: "lazy" }).props })),
    ]),
  );
}
