// Модерация фото: пороги цензуры (как в плане, граница не включается) и причины возврата. Общий файл (сервер, экраны, unit).

export const NSFW_THRESHOLDS = { pornHentai: 0.7, sexy: 0.85 };

// Флаг «проверит модератор»: porn + hentai > 0,7 или sexy > 0,85
export function needsModeration(nsfw) {
  if (!nsfw) return false;
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  return n(nsfw.porn) + n(nsfw.hentai) > NSFW_THRESHOLDS.pornHentai || n(nsfw.sexy) > NSFW_THRESHOLDS.sexy;
}

export const RETURN_REASONS = {
  explicit: "Откровенное содержание — такое не печатаем",
  violence: "Жестокость",
  personal_data: "Видны документы или чужие личные данные",
  rights: "Чужие права (логотип, кадр из фильма)",
  quality: "Не подходит для печати",
  other: "Другое",
};
