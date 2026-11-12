// Фото продуктов PicPac (W-04, K-10): сжатые копии из docs/superpicpac/photos (оригиналы в репозиторий не копируем).
// Запуск из папки приложения: node scripts/product-photos.mjs
//   assets/products/<slug>/NN.webp — до 1200 px по длинной стороне, WebP q75 (статический импорт: размеры и размытая заглушка)
//   public/payment/<имя>.webp       — логотипы оплаты 160 px по ширине, для корзины
// Фото — ООО «Фотопринт», только для прототипа хакатона (docs/licenses.md).
import { createRequire } from "node:module";
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const APP = resolve(".");
const require = createRequire(join(APP, "package.json"));
const sharp = require("sharp");
const SRC = resolve(APP, process.env.PHOTOS_SRC || "../../docs/superpicpac/photos");

// slug продукта → [папка-источник, номера фото]; первое — обложка карточки каталога
export const PLAN = {
  "pages-book": ["lite", ["01", "05", "02", "03", "06", "07"]],
  layflat: ["classic", ["02", "10", "04", "07", "01", "08", "06"]],
  "photopaper-book": ["premium", ["02", "10", "01", "05", "08", "03"]],
  photo: ["photo-print", ["11", "08", "02", "05", "06", "09"]],
  digital: ["photo-print", ["04", "01", "03", "07", "10"]],
};
const PAYMENT = ["visa", "mastercard", "belkart", "erip", "bepaid"];

let total = 0;
for (const [slug, [dir, nums]] of Object.entries(PLAN)) {
  const out = join(APP, "assets/products", slug);
  mkdirSync(out, { recursive: true });
  for (const n of nums) {
    const file = join(out, n + ".webp");
    let q = 75;
    for (;;) {
      await sharp(join(SRC, dir, n + ".webp"))
        .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
        .webp({ quality: q, effort: 6 })
        .toFile(file);
      if (statSync(file).size <= 150 * 1024 || q <= 60) break;
      q -= 7;
    }
    total += statSync(file).size;
    console.log(`${slug}/${n}.webp ${Math.round(statSync(file).size / 1024)} КБ (q${q})`);
  }
}
const pay = join(APP, "public/payment");
mkdirSync(pay, { recursive: true });
for (const name of PAYMENT) {
  const file = join(pay, name + ".webp");
  await sharp(join(SRC, "payment", name + ".png")).resize({ width: 160 }).webp({ quality: 85 }).toFile(file);
  total += statSync(file).size;
  console.log(`payment/${name}.webp ${Math.round(statSync(file).size / 1024)} КБ`);
}
console.log(`Итого ${Math.round(total / 1024)} КБ`);
