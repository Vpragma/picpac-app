// Обёртка редактора: свой заголовок вкладки (N-08, страница клиентская — metadata задаём здесь)
// и тост удержания при уходе (D5, W-13). Сам редактор — app/editor/page.js.
import EditorLeaveToast from "@/components/EditorLeaveToast";
import "./book.css"; // N11: превью книги и шаблоны оформления

export const metadata = { title: "Редактор фотокниги — PicPac" };

export default function EditorLayout({ children }) {
  return (
    <>
      {children}
      <EditorLeaveToast />
    </>
  );
}
