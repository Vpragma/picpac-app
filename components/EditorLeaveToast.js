"use client";
// W-13 (D5): ушли из редактора с книгой, где есть фото, — один раз за сеанс тихий тост
// «Книга сохранена. Вернуться можно в «Мои книги»». Без окон и вопросов; в «Мои книги» — не показываем.
import { useEffect } from "react";
import { getDraftState } from "../lib/draft";
import { toast } from "../lib/store";

const KEY = "picpac:kept-toast";

export default function EditorLeaveToast() {
  useEffect(
    () => () => {
      // Адрес проверяем уже после перехода: при двойном запуске эффектов в dev мы ещё в редакторе
      setTimeout(() => {
        const path = window.location.pathname;
        if (path.startsWith("/editor") || path.startsWith("/books")) return;
        const s = getDraftState();
        const d = s?.projects?.[s?.currentId];
        if (!d || !(d.photos?.length > 0) || d.status === "ordered") return;
        try {
          if (sessionStorage.getItem(KEY)) return;
          sessionStorage.setItem(KEY, "1");
        } catch {
          return;
        }
        toast("Книга сохранена. Вернуться можно в «Мои книги»");
      }, 0);
    },
    [],
  );
  return null;
}
