// /qr — крупный QR-код на адрес этого сайта для экрана проектора (D9) и коротко, как установить приложение.
// QR рисует сервер (inline SVG), в браузер не уходит ни строчки JS этой страницы.
import Link from "next/link";
import { qrSvg, siteUrl } from "@/lib/server/qr";

export const metadata = { title: "QR-код — PicPac", description: "Откройте PicPac на телефоне по QR-коду и установите на экран «Домой»." };

export default async function QrPage() {
  const url = await siteUrl();
  const svg = await qrSvg(url);
  return (
    <div className="qr-page">
      <h1>Откройте PicPac на телефоне</h1>
      <p className="muted">Наведите камеру телефона на код.</p>
      {/* SVG создаёт библиотека qrcode из адреса сайта — только геометрия, без текста и скриптов */}
      <div className="qr-big" role="img" aria-label={`QR-код: ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="qr-url">
        <strong>{url.replace(/^https?:\/\//, "")}</strong>
      </p>
      <div className="qr-steps">
        <section className="card">
          <h2>iPhone</h2>
          <p className="small">Safari → «Поделиться» → «На экран „Домой“» → «Добавить». Откройте PicPac со значка → Профиль → «Уведомления» → «Разрешить».</p>
        </section>
        <section className="card">
          <h2>Android</h2>
          <p className="small">Chrome → ⋮ → «Установить приложение». Откройте PicPac → Профиль → «Уведомления» → «Разрешить».</p>
        </section>
      </div>
      <p className="small">
        <Link href="/help#install">Подробнее об установке</Link>
      </p>
    </div>
  );
}
