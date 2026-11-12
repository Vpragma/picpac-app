"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { copyProject, deleteProject, openProject, useDraft } from "../../lib/draft";
import DraftError from "../../components/DraftError";
import { useCatalog } from "../../lib/useCatalog";
import { notify } from "../../lib/store";
import { isClient, useMe } from "../../lib/me";
import { useSyncState } from "../../lib/sync";

const STATUS = {
  draft: { label: "Черновик", chip: "" },
  in_cart: { label: "В корзине", chip: " chip-hl" },
  ordered: { label: "Заказан", chip: " chip-ok" },
};

export default function BooksPage() {
  const { ready, error, projects, thumbs } = useDraft();
  const { data: catalog } = useCatalog();
  const me = useMe();
  const sync = useSyncState();
  if (error) return <DraftError />;
  if (!ready) return <p className="muted">Загружаем…</p>;
  const list = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt);
  const active = list.filter((p) => p.status !== "ordered");
  const ordered = list.filter((p) => p.status === "ordered");
  const productOf = (p) => catalog?.products.find((x) => x.slug === p.productSlug);
  // Вошедший клиент: пока не пришёл список проектов аккаунта, «Черновиков пока нет» не показываем
  const accountLoading = me === null || (isClient(me) && !sync.listLoaded);
  return (
    <div>
      <h1>Мои книги и фото</h1>
      {sync.photosLeft > 0 && (
        <p className="muted small" role="status" data-testid="photos-loading">
          Загружаем фото из аккаунта… {sync.photosTotal - sync.photosLeft} из {sync.photosTotal}
        </p>
      )}
      {active.length === 0 && accountLoading ? (
        <p className="muted" role="status" data-testid="account-loading">
          Загружаем проекты из аккаунта…
        </p>
      ) : active.length === 0 ? (
        <div className="card">
          <p>Черновиков пока нет.</p>
          <p className="muted">Соберите книгу — история семьи, путешествие или просто тёплые дни.</p>
          <Link href="/" className="btn btn-primary">
            В каталог
          </Link>
        </div>
      ) : (
        active.map((p) => <ProjectCard key={p.id} p={p} product={productOf(p)} thumbs={thumbs} />)
      )}
      {active.length > 0 && (
        <Link href="/" className="btn btn-block" style={{ marginTop: 8 }}>
          + Новый проект
        </Link>
      )}
      {ordered.length > 0 && (
        <>
          <h2 style={{ marginTop: 24 }}>Заказанные</h2>
          <p className="muted small">Оформленный проект не меняется. Чтобы напечатать такой же или поправить — «Заказать ещё раз»: появится копия-черновик.</p>
          {ordered.map((p) => (
            <ProjectCard key={p.id} p={p} product={productOf(p)} thumbs={thumbs} />
          ))}
        </>
      )}
    </div>
  );
}

function ProjectCard({ p, product, thumbs }) {
  const router = useRouter();
  const st = STATUS[p.status] || STATUS.draft;
  const name = product ? (product.kind === "book" ? "Фотокнига " : "") + product.name : "Проект";
  const when = new Date(p.updatedAt).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  async function open() {
    await openProject(p.id);
    router.push("/editor");
  }
  async function again() {
    try {
      await copyProject(p.id);
      notify("Копия проекта готова — можно менять и заказывать", "success");
      router.push("/editor");
    } catch (e) {
      console.error(e);
      notify("Не получилось сделать копию. Попробуйте ещё раз.", "error");
    }
  }
  return (
    <div className="card">
      <div className="row between">
        <b style={{ color: "var(--ds-color-text-strong)" }}>{name}</b>
        <span className={"chip" + st.chip}>{st.label}</span>
      </div>
      <div className="muted small">
        {p.sizeId?.replace("x", "×")} см{p.pages ? ` · ${p.pages} стр.` : ""} · {p.photos.length} фото · {p.status === "ordered" && p.orderNumber ? `заказ ${p.orderNumber}` : `изменён ${when}`}
      </div>
      <div className="photo-grid" style={{ gridTemplateColumns: "repeat(6, 1fr)", gap: 4, margin: "12px 0" }}>
        {p.photos.slice(0, 6).map((ph) => (
          <div key={ph.id} className="photo-cell">
            {thumbs[ph.id] && (
              // eslint-disable-next-line @next/next/no-img-element -- миниатюра с устройства (blob: из IndexedDB): next/image её не оптимизирует, оптимизатор Vercel для фото клиентов не используем
              <img src={thumbs[ph.id]} alt="" />
            )}
          </div>
        ))}
      </div>
      <div className="row wrap">
        {p.status === "ordered" ? (
          <>
            {p.orderId && (
              <Link href={"/orders/" + p.orderId} className="btn btn-small btn-primary">
                Открыть заказ
              </Link>
            )}
            <button className="btn btn-small" onClick={again}>
              Заказать ещё раз
            </button>
          </>
        ) : (
          <>
            <button className="btn btn-small btn-primary" onClick={open}>
              Продолжить
            </button>
            {p.status === "in_cart" && (
              <Link href="/cart" className="btn btn-small">
                В корзину
              </Link>
            )}
            <button
              className="btn btn-small"
              onClick={() => {
                if (window.confirm("Удалить этот проект и его фото с этого устройства?")) deleteProject(p.id);
              }}
            >
              Удалить
            </button>
          </>
        )}
      </div>
    </div>
  );
}
