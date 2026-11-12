// Обёртка редактора: только тост удержания при уходе (D5, W-13). Сам редактор — app/editor/page.js.
import EditorLeaveToast from "@/components/EditorLeaveToast";

export default function EditorLayout({ children }) {
  return (
    <>
      {children}
      <EditorLeaveToast />
    </>
  );
}
