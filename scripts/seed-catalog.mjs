// Наполняет каталог в базе: продукты, размеры, опции, способы доставки, тестовые промокоды.
// Все цифры — из docs/superpicpac/superpicpac.md (снято 11.11.2026).
// Повторный запуск безопасен: строки обновляются по ключу (on conflict do update), дублей нет.
// Запуск: npm run seed:catalog (адрес базы — POSTGRES_URL_NON_POOLING из .env.local).
import postgres from "postgres";

const url = process.env.POSTGRES_URL_NON_POOLING;
if (!url) {
  console.error("Нет переменной POSTGRES_URL_NON_POOLING. Выполните: npm run env:sync");
  process.exit(1);
}

// Тестовый коэффициент цены книги от площади страницы (план ночи, раздел 10).
// 20×20 → 1. Уточнить у Фотопринт.
const k = (w, h) => Math.round((1 + 0.6 * ((w * h) / 400 - 1)) * 1000) / 1000;

// Требования к фото (одинаковые для всех продуктов): формат, вес, плотность точек
const requirements = {
  formats: ["image/jpeg", "image/png"],
  maxBytes: 25 * 1024 * 1024,
  dpi: { excellent: 300, good: 150, warn: 100 },
  text: "JPEG или PNG до 25 МБ. Для чёткой печати — от 150 точек на дюйм на своём месте, лучше 300. Меньше 100 — будет размыто.",
};

const books = [
  {
    slug: "pages-book", name: "Lite", tagline: "Альбом за год, детские рисунки, фото с телефона",
    description: "Тонкая гладкая бумага без плёнки, листается как журнал. Обложка твёрдая, с вашим фото, глянцевая.",
    pages: [24, 160], photos: [24, 480], base: 7000, per2: 200, sort: 10,
    sizes: [["20x20", "Квадрат", 20, 20], ["26x26", "Большой квадрат", 26, 26], ["21x30", "Как лист А4", 21, 30]],
    options: [["cover", "gloss", "Глянцевая", "Твёрдая, с вашим фото", true], ["paper", "thin", "Тонкая гладкая", "Без плёнки, листается как журнал", true]],
  },
  {
    slug: "layflat", name: "Classic", badge: "выбор pic pac", tagline: "Семейный альбом, путешествие, выпускной",
    description: "Плотные страницы под ламинацией, раскрытие на 180° без шва.",
    pages: [20, 60], photos: [20, 180], base: 8100, per2: 300, sort: 20,
    sizes: [["20x20", "Квадрат", 20, 20], ["21x30", "Как лист А4", 21, 30]],
    options: [
      ["cover", "gloss", "Глянцевая", "Яркая, с блеском", true], ["cover", "matte", "Матовая", "Без бликов", false],
      ["lamination", "gloss", "Глянцевая", "Как обложка", true], ["lamination", "matte", "Матовая", "Без бликов", false],
    ],
  },
  {
    slug: "photopaper-book", name: "Premium", tagline: "Свадьба, юбилей, подарок к большой дате",
    description: "Матовая фотобумага, наклеенная на картон. Обложка твёрдая, глянцевая.",
    pages: [10, 60], photos: [10, 180], base: 10050, per2: 700, sort: 30,
    sizes: [["20x20", "Квадрат", 20, 20], ["30x20", "Альбомный", 30, 20], ["25x25", "Большой квадрат", 25, 25], ["30x30", "Самый большой", 30, 30], ["21x30", "Как лист А4", 21, 30]],
    options: [["cover", "gloss", "Глянцевая", "Твёрдая", true], ["paper", "photo-matte", "Матовая фотобумага", "Наклеена на картон", true]],
  },
];

const surfaces = [["surface", "gloss", "Глянцевая", "Ярче, но видны отпечатки пальцев", true], ["surface", "matte", "Матовая", "Без бликов и отпечатков", false]];
const prints = [
  {
    slug: "photo", name: "Печать фото", tagline: "Фотохимическая печать на фотобумаге, как в фотоателье",
    description: "Заказ от 1 штуки. Края могут срезаться на несколько миллиметров. Много фото раскладываем по конвертам — приходят одной посылкой.",
    sort: 40,
    sizes: [["10x15", "Обычное фото", 10, 15, 130], ["15x20", "Чуть больше", 15, 20, 160], ["20x30", "Почти как лист А4", 20, 30, 320], ["30x45", "Постер", 30, 45, 2000]],
    options: [...surfaces, ["print", "photochemical", "Фотохимическая", "На фотобумаге, как в фотоателье", true]],
  },
  {
    slug: "digital", name: "Цифровая печать", tagline: "Дешевле, цвета проще",
    description: "Цифровая печать фото. Заказ от 1 штуки.",
    sort: 50,
    // Цены цифровой печати других размеров на сайте не видны — только 10×15
    sizes: [["10x15", "Обычное фото", 10, 15, 61]],
    options: [...surfaces, ["print", "digital", "Цифровая", "Дешевле, цвета проще", true]],
  },
];

const delivery = [
  ["europost", "Европочта", "в пункт выдачи", 590, null, "от 2 дней", 2, 3, ["pickup_point"], 10],
  ["belpost", "Белпочта", "в почтовое отделение", 690, 15000, "от 2 дней", 2, 3, ["city", "street", "house", "postcode"], 20],
  ["ems", "EMS", "курьер по Беларуси", 2090, 30000, "1–2 дня", 1, 2, ["city", "street", "house", "flat"], 30],
  ["courier-minsk", "Курьер Европочты по Минску", "до двери, на выбранную дату", 1490, null, "на выбранную дату", 1, 2, ["street", "house", "flat"], 40],
  ["courier-by", "Курьер Европочты по Беларуси", "до двери, на выбранную дату", 1990, null, "на выбранную дату", 1, 3, ["city", "street", "house", "flat"], 50],
];

const promos = [
  ["TEST10", "percent", 10, 0, null, null, "−10% на заказ"],
  ["FREESHIP", "free_delivery", 0, 0, null, null, "Бесплатная доставка"],
  ["PICPAC5", "amount", 500, 5000, null, null, "−5,00 руб. при заказе от 50,00 руб."],
  // Истёкший код — для проверки сообщения «Истёк»
  ["OLD2025", "percent", 15, 0, "2025-01-01T00:00:00+03:00", "2025-12-31T23:59:59+03:00", "−15% (акция 2025 года)"],
];

const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
try {
  await sql.begin(async (tx) => {
    for (const b of books) {
      await tx`
        insert into public.products (slug, name, kind, tagline, description, badge, print_days, min_pages, max_pages, page_step,
          min_photos, max_photos, base_price_kop, per2_pages_kop, photo_requirements, sort, active, updated_at)
        values (${b.slug}, ${b.name}, 'book', ${b.tagline}, ${b.description}, ${b.badge || null}, 3, ${b.pages[0]}, ${b.pages[1]}, 2,
          ${b.photos[0]}, ${b.photos[1]}, ${b.base}, ${b.per2}, ${sql.json(requirements)}, ${b.sort}, true, now())
        on conflict (slug) do update set name = excluded.name, kind = excluded.kind, tagline = excluded.tagline,
          description = excluded.description, badge = excluded.badge, print_days = excluded.print_days,
          min_pages = excluded.min_pages, max_pages = excluded.max_pages, page_step = excluded.page_step,
          min_photos = excluded.min_photos, max_photos = excluded.max_photos, base_price_kop = excluded.base_price_kop,
          per2_pages_kop = excluded.per2_pages_kop, photo_requirements = excluded.photo_requirements, sort = excluded.sort,
          active = true, updated_at = now()`;
      let i = 0;
      for (const [code, label, w, h] of b.sizes) {
        await tx`
          insert into public.product_sizes (product_slug, code, label, width_cm, height_cm, price_k, unit_price_kop, sort, active)
          values (${b.slug}, ${code}, ${label}, ${w}, ${h}, ${k(w, h)}, null, ${i++}, true)
          on conflict (product_slug, code) do update set label = excluded.label, width_cm = excluded.width_cm,
            height_cm = excluded.height_cm, price_k = excluded.price_k, sort = excluded.sort, active = true`;
      }
      await upsertOptions(tx, b.slug, b.options);
    }
    for (const p of prints) {
      await tx`
        insert into public.products (slug, name, kind, tagline, description, print_days, min_photos, max_photos, photo_requirements, sort, active, updated_at)
        values (${p.slug}, ${p.name}, 'print', ${p.tagline}, ${p.description}, 2, 1, 500, ${sql.json(requirements)}, ${p.sort}, true, now())
        on conflict (slug) do update set name = excluded.name, kind = excluded.kind, tagline = excluded.tagline,
          description = excluded.description, print_days = excluded.print_days, min_photos = excluded.min_photos,
          max_photos = excluded.max_photos, photo_requirements = excluded.photo_requirements, sort = excluded.sort,
          active = true, updated_at = now()`;
      let i = 0;
      for (const [code, label, w, h, price] of p.sizes) {
        await tx`
          insert into public.product_sizes (product_slug, code, label, width_cm, height_cm, price_k, unit_price_kop, sort, active)
          values (${p.slug}, ${code}, ${label}, ${w}, ${h}, 1, ${price}, ${i++}, true)
          on conflict (product_slug, code) do update set label = excluded.label, width_cm = excluded.width_cm,
            height_cm = excluded.height_cm, unit_price_kop = excluded.unit_price_kop, sort = excluded.sort, active = true`;
      }
      await upsertOptions(tx, p.slug, p.options);
    }
    for (const [code, name, note, price, free, eta, min, max, fields, sort] of delivery) {
      await tx`
        insert into public.delivery_methods (code, name, note, price_kop, free_from_kop, eta_text, min_days, max_days, address_fields, sort, active)
        values (${code}, ${name}, ${note}, ${price}, ${free}, ${eta}, ${min}, ${max}, ${fields}, ${sort}, true)
        on conflict (code) do update set name = excluded.name, note = excluded.note, price_kop = excluded.price_kop,
          free_from_kop = excluded.free_from_kop, eta_text = excluded.eta_text, min_days = excluded.min_days,
          max_days = excluded.max_days, address_fields = excluded.address_fields, sort = excluded.sort, active = true`;
    }
    for (const [code, kind, value, min, from, to, label] of promos) {
      await tx`
        insert into public.promo_codes (code, kind, value, min_total_kop, valid_from, valid_to, label, active, is_synthetic)
        values (${code}, ${kind}, ${value}, ${min}, ${from}, ${to}, ${label}, true, true)
        on conflict (code) do update set kind = excluded.kind, value = excluded.value, min_total_kop = excluded.min_total_kop,
          valid_from = excluded.valid_from, valid_to = excluded.valid_to, label = excluded.label, active = true`;
    }
  });
  const [{ n: products }] = await sql`select count(*)::int n from public.products where active`;
  const [{ n: sizes }] = await sql`select count(*)::int n from public.product_sizes`;
  const [{ n: options }] = await sql`select count(*)::int n from public.product_options`;
  const [{ n: methods }] = await sql`select count(*)::int n from public.delivery_methods`;
  const [{ n: codes }] = await sql`select count(*)::int n from public.promo_codes`;
  console.log(`Готово: продуктов ${products}, размеров ${sizes}, опций ${options}, способов доставки ${methods}, промокодов ${codes}.`);
} catch (e) {
  console.error("Ошибка наполнения каталога:", e?.message || e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

async function upsertOptions(tx, slug, options) {
  let i = 0;
  for (const [group, code, label, note, isDefault] of options) {
    await tx`
      insert into public.product_options (product_slug, option_group, code, label, note, price_delta_kop, is_default, sort)
      values (${slug}, ${group}, ${code}, ${label}, ${note}, 0, ${isDefault}, ${i++})
      on conflict (product_slug, option_group, code) do update set label = excluded.label, note = excluded.note,
        is_default = excluded.is_default, sort = excluded.sort`;
  }
}
