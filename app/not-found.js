import Link from "next/link";

export const metadata = { title: "Страница не найдена — PicPac" };

export default function NotFound() {
  return (
    <div className="card" style={{ textAlign: "center", marginTop: 24 }}>
      <h1>Такой страницы нет</h1>
      <p className="muted">Возможно, ссылка устарела или в ней опечатка. Зато в каталоге всё на месте.</p>
      <Link href="/" className="btn btn-primary" style={{ marginTop: 8 }}>
        В каталог
      </Link>
    </div>
  );
}
