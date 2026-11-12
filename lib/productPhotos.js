// Фото продуктов (W-04, K-10): сжатые копии из docs/superpicpac/photos (scripts/product-photos.mjs).
// Статический импорт даёт размеры (без сдвига вёрстки) и размытую заглушку. Импортировать только из серверных компонентов:
// так фото не попадают в JS браузера. Фото — ООО «Фотопринт», только для прототипа хакатона.
import pages_book_01 from "@/assets/products/pages-book/01.webp";
import pages_book_05 from "@/assets/products/pages-book/05.webp";
import pages_book_02 from "@/assets/products/pages-book/02.webp";
import pages_book_03 from "@/assets/products/pages-book/03.webp";
import pages_book_06 from "@/assets/products/pages-book/06.webp";
import pages_book_07 from "@/assets/products/pages-book/07.webp";
import layflat_02 from "@/assets/products/layflat/02.webp";
import layflat_10 from "@/assets/products/layflat/10.webp";
import layflat_04 from "@/assets/products/layflat/04.webp";
import layflat_07 from "@/assets/products/layflat/07.webp";
import layflat_01 from "@/assets/products/layflat/01.webp";
import layflat_08 from "@/assets/products/layflat/08.webp";
import layflat_06 from "@/assets/products/layflat/06.webp";
import photopaper_book_02 from "@/assets/products/photopaper-book/02.webp";
import photopaper_book_10 from "@/assets/products/photopaper-book/10.webp";
import photopaper_book_01 from "@/assets/products/photopaper-book/01.webp";
import photopaper_book_05 from "@/assets/products/photopaper-book/05.webp";
import photopaper_book_08 from "@/assets/products/photopaper-book/08.webp";
import photopaper_book_03 from "@/assets/products/photopaper-book/03.webp";
import photo_11 from "@/assets/products/photo/11.webp";
import photo_08 from "@/assets/products/photo/08.webp";
import photo_02 from "@/assets/products/photo/02.webp";
import photo_05 from "@/assets/products/photo/05.webp";
import photo_06 from "@/assets/products/photo/06.webp";
import photo_09 from "@/assets/products/photo/09.webp";
import digital_04 from "@/assets/products/digital/04.webp";
import digital_01 from "@/assets/products/digital/01.webp";
import digital_03 from "@/assets/products/digital/03.webp";
import digital_07 from "@/assets/products/digital/07.webp";
import digital_10 from "@/assets/products/digital/10.webp";

// slug → фото; первое — обложка карточки каталога и главное фото на странице продукта
export const PRODUCT_PHOTOS = {
  "pages-book": [
    { src: pages_book_01, alt: "Фотокнига Lite: книга в руках" },
    { src: pages_book_05, alt: "Фотокнига Lite: разворот" },
    { src: pages_book_02, alt: "Фотокнига Lite: пример 3" },
    { src: pages_book_03, alt: "Фотокнига Lite: пример 4" },
    { src: pages_book_06, alt: "Фотокнига Lite: пример 5" },
    { src: pages_book_07, alt: "Фотокнига Lite: пример 6" }
  ],
  "layflat": [
    { src: layflat_02, alt: "Фотокнига Classic: разворот рядом с чашкой кофе" },
    { src: layflat_10, alt: "Фотокнига Classic: обложка в руках" },
    { src: layflat_04, alt: "Фотокнига Classic: раскрывается на 180°" },
    { src: layflat_07, alt: "Фотокнига Classic: раскрывается на 180°" },
    { src: layflat_01, alt: "Фотокнига Classic: пример 5" },
    { src: layflat_08, alt: "Фотокнига Classic: пример 6" },
    { src: layflat_06, alt: "Фотокнига Classic: пример 7" }
  ],
  "photopaper-book": [
    { src: photopaper_book_02, alt: "Фотокнига Premium: свадебный разворот" },
    { src: photopaper_book_10, alt: "Фотокнига Premium: обложки" },
    { src: photopaper_book_01, alt: "Фотокнига Premium: пример 3" },
    { src: photopaper_book_05, alt: "Фотокнига Premium: пример 4" },
    { src: photopaper_book_08, alt: "Фотокнига Premium: пример 5" },
    { src: photopaper_book_03, alt: "Фотокнига Premium: пример 6" }
  ],
  "photo": [
    { src: photo_11, alt: "Печать фото: три отпечатка" },
    { src: photo_08, alt: "Печать фото: отпечатки веером" },
    { src: photo_02, alt: "Печать фото: пример 3" },
    { src: photo_05, alt: "Печать фото: пример 4" },
    { src: photo_06, alt: "Печать фото: пример 5" },
    { src: photo_09, alt: "Печать фото: пример 6" }
  ],
  "digital": [
    { src: digital_04, alt: "Цифровая печать: пачка фото в руке" },
    { src: digital_01, alt: "Цифровая печать: пример 2" },
    { src: digital_03, alt: "Цифровая печать: пример 3" },
    { src: digital_07, alt: "Цифровая печать: пример 4" },
    { src: digital_10, alt: "Цифровая печать: пример 5" }
  ],
};

export function productPhotos(slug) {
  return PRODUCT_PHOTOS[slug] || [];
}
