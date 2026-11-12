// Админка → «Каталог» (N9, только админ): цены, коэффициенты размеров, плашки «новинка» / «скидка» / «выбор pic pac»
// и старая цена (зачёркнута в каталоге). Проверки — на сервере, каждая правка — в журнале.
import Link from "next/link";
import CatalogEditor from "@/components/admin/CatalogEditor";
import { BADGES, loadAdminCatalog } from "@/lib/server/adminCatalog";
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Каталог — PicPac" };

// Классы плашек — как у карточек каталога (N1: .tag-new / .tag-sale / .tag-choice)
const TAG = { новинка: "tag tag-new", скидка: "tag tag-sale", "выбор pic pac": "tag tag-choice" };
const byn = (kop) => (kop == null ? "—" : (kop / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " BYN");

export default async function AdminCatalogPage() {
  await requirePageRole(["admin"], "/admin/catalog");
  const products = await loadAdminCatalog(createSupabaseAdmin()).catch((e) => {
    console.error(e?.message);
    return null;
  });
  return (
    <div>
      <h1>Каталог</h1>
      <p className="muted small">
        Цены — в рублях. Книга: цена «от» за минимум страниц размера 20×20, надбавка за каждые 2 страницы и коэффициент размера. Печать фото: цена каждого отпечатка. Сумму заказа всегда
        считает сервер по этим ценам. Каждая правка записывается в <Link href="/admin/audit?quick=admin">журнал</Link>.
      </p>
      {!products && (
        <div className="card" role="alert">
          <b className="err-text">Не получилось загрузить каталог.</b>
        </div>
      )}
      {products?.map((p) => (
        <section key={p.slug} className="card catalog-card" aria-labelledby={`h-${p.slug}`} data-testid={`catalog-${p.slug}`}>
          <div className="row between wrap">
            <h2 id={`h-${p.slug}`}>
              {p.name} <span className="muted small">· {p.kind === "book" ? "фотокнига" : "печать"}</span>
            </h2>
            <span className="row" style={{ gap: 8 }}>
              {p.badge && <span className={TAG[p.badge] || "tag"}>{p.badge}</span>}
              <span className="price-row small">
                {p.oldPriceKop != null && p.oldPriceKop > (p.priceFromKop || 0) && <s className="price-old">{byn(p.oldPriceKop)}</s>}
                <span className="price-now">от {byn(p.priceFromKop)}</span>
              </span>
              {!p.active && <span className="chip">выключен</span>}
            </span>
          </div>
          <CatalogEditor product={p} badges={BADGES} />
        </section>
      ))}
    </div>
  );
}
