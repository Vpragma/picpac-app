// Сюда proxy.js тихо переадресует отказ в доступе к страницам админки.
// Адрес в браузере не меняется, а сервер отвечает кодом 401 или 403 с понятной страницей.
import { forbidden, notFound, unauthorized } from "next/navigation";

export default async function DeniedPage({ params }) {
  const { code } = await params;
  if (code === "401") unauthorized();
  if (code === "403") forbidden();
  notFound();
}
