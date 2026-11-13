// N7 (C2): ошибка «кусок кода не скачался» (ChunkLoadError Turbopack, ошибки import() у браузеров) — обычно нет сети,
// а этот кусок ещё не сохранён на устройстве. Такие ошибки показываем понятным текстом, а не «Что-то пошло не так».
export function isChunkError(e) {
  const s = `${e?.name || ""} ${e?.message || ""}`;
  return /ChunkLoadError|Loading (?:CSS )?chunk|Failed to load chunk|dynamically imported module|Importing a module script failed/i.test(s);
}
