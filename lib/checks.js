// Проверка перед заказом: пустые страницы, формат, разрешение.
import { autoLayout, printDpi, slotDpi } from "./layout";
import { pagesForPhotos } from "./price";

export const DPI_WARN = 150; // меньше — «может быть нечётко»
export const DPI_BAD = 100; // меньше — «будет размыто»

function dpiIssue(photo, dpi, where) {
  if (dpi == null || dpi >= DPI_WARN) return null;
  const bad = dpi < DPI_BAD;
  return {
    key: "dpi:" + photo.id,
    level: bad ? "err" : "warn",
    photoId: photo.id,
    title: bad ? "Будет размыто" : "Может быть нечётко",
    text: `${where}: у фото «${photo.name}» ${photo.w}×${photo.h} точек — это ${dpi} точек на дюйм на своём месте. Для чёткой печати нужно от 150, лучше 300. Возьмите оригинал фото (не из мессенджера) или замените снимок.`,
    actions: ["replace"],
  };
}

export function runChecks(draft, product) {
  const issues = [];
  if (!draft || !product) return { issues, layout: null };
  const size = product.sizes.find((s) => s.id === draft.sizeId) || product.sizes[0];

  if (draft.photos.length === 0) {
    issues.push({ key: "nophotos", level: "err", title: "Нет фото", text: "Добавьте хотя бы одно фото.", actions: ["add"], blocking: true });
  }

  for (const p of draft.photos) {
    if (!p.supported && p.tooBig) {
      issues.push({
        key: "big:" + p.id,
        level: "err",
        photoId: p.id,
        title: "Файл слишком большой",
        text: `«${p.name}» весит ${(p.size / 1048576).toFixed(1).replace(".", ",")} МБ, а мы принимаем до 25 МБ. Сохраните фото в меньшем размере (например, экспорт «Большой» вместо «Оригинал») или замените его. Если продолжить, это фото не попадёт в заказ.`,
        actions: ["replace"],
      });
    } else if (!p.supported && p.tooManyPixels) {
      issues.push({
        key: "px:" + p.id,
        level: "err",
        photoId: p.id,
        title: "Фото слишком большое",
        text: `«${p.name}» — ${p.w}×${p.h} точек, это больше 100 мегапикселей. Такое фото мы не обработаем: уменьшите его (например, до 12 000 точек по длинной стороне) или замените. Если продолжить, это фото не попадёт в заказ.`,
        actions: ["replace"],
      });
    } else if (!p.supported) {
      const known = /heic|heif/i.test(p.type + p.name) ? "HEIC (формат iPhone)" : /webp/i.test(p.type + p.name) ? "WebP" : /gif/i.test(p.type + p.name) ? "GIF" : p.type;
      issues.push({
        key: "fmt:" + p.id,
        level: "err",
        photoId: p.id,
        title: "Формат не подходит",
        text: `«${p.name}» — это ${known}, такой файл мы не напечатаем. Подходят JPEG и PNG: сохраните фото как JPEG (на iPhone: Настройки → Камера → Форматы → «Наиболее совместимые») или замените снимок. Если продолжить, это фото не попадёт в заказ.`,
        actions: ["replace"],
      });
    }
  }

  const usable = draft.photos.filter((p) => p.supported);
  let layout = null;

  if (product.kind === "book") {
    layout = autoLayout(usable, draft.pages);
    layout.pages.forEach((pg, i) => {
      for (const s of pg.slots) {
        const photo = usable.find((x) => x.id === s.photoId);
        const iss = dpiIssue(photo, slotDpi(photo, s, size.w, size.h), "Страница " + (i + 1));
        if (iss) issues.push(iss);
      }
    });
    const empty = layout.pages.map((p, i) => (p.slots.length ? null : i + 1)).filter(Boolean);
    if (usable.length && empty.length) {
      const fit = pagesForPhotos(product, usable.length);
      issues.push({
        key: "empty",
        level: "warn",
        title: `Пустые страницы: ${empty.length}`,
        text: `Фото хватает не на все страницы — страницы ${shortList(empty)} останутся белыми. Добавьте фото${fit < draft.pages ? ` или уменьшите книгу до ${fit} страниц` : ""}.`,
        actions: fit < draft.pages ? ["add", "fitPages"] : ["add"],
        fitPages: fit,
      });
    }
    if (layout.overflow.length) {
      const fit = pagesForPhotos(product, usable.length);
      issues.push({
        key: "overflow",
        level: "err",
        title: `Не поместились фото: ${layout.overflow.length}`,
        text: `На ${draft.pages} страницах помещается до ${draft.pages * 3} фото. Добавьте страницы${fit > draft.pages ? ` (нужно ${fit})` : ""} или уберите лишние фото. Если продолжить, они не попадут в книгу.`,
        actions: fit > draft.pages ? ["fitPages"] : [],
        fitPages: fit,
      });
    }
  } else {
    for (const p of usable) {
      const iss = dpiIssue(p, printDpi(p, size), "Отпечаток " + size.id.replace("x", "×"));
      if (iss) issues.push(iss);
    }
  }
  return { issues, layout };
}

function shortList(nums) {
  if (nums.length <= 4) return nums.join(", ");
  return `${nums[0]}–${nums[nums.length - 1]}`;
}
