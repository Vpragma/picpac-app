"use client";
// N9: правка продукта — цены в рублях (на сервер уходят копейки), коэффициенты размеров, плашка, старая цена.
// Сервер ещё раз проверяет пределы и что старая цена больше текущей «от», пишет журнал и пересчитывает цены клиентов.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { callApi } from "@/lib/api";

const toRub = (kop) => (kop == null ? "" : (kop / 100).toFixed(2).replace(".", ","));
// «12,5» или «12.50» → 1250 копеек; пусто → null; не число → NaN
const toKop = (s) => {
  const t = String(s ?? "").trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
};

export default function CatalogEditor({ product, badges }) {
  const router = useRouter();
  const isBook = product.kind === "book";
  const [base, setBase] = useState(toRub(product.basePriceKop));
  const [per2, setPer2] = useState(toRub(product.per2PagesKop));
  const [old, setOld] = useState(toRub(product.oldPriceKop));
  const [badge, setBadge] = useState(product.badge || "");
  const [sizes, setSizes] = useState(product.sizes.map((s) => ({ code: s.code, label: s.label, k: String(s.priceK), unit: toRub(s.unitPriceKop) })));
  const [state, setState] = useState({ busy: false, error: "", ok: "" });

  function setSize(code, key, value) {
    setSizes((list) => list.map((s) => (s.code === code ? { ...s, [key]: value } : s)));
  }

  async function save(e) {
    e.preventDefault();
    if (state.busy) return;
    const body = { badge: badge || null };
    const bad = (text) => setState({ busy: false, error: text, ok: "" });
    if (isBook) {
      const b = toKop(base);
      const p = toKop(per2);
      if (!Number.isFinite(b)) return bad("Цена книги — число, например 70,00.");
      if (!Number.isFinite(p)) return bad("Надбавка за 2 страницы — число, например 2,00.");
      body.basePriceKop = b;
      body.per2PagesKop = p;
      body.sizes = sizes.map((s) => ({ code: s.code, priceK: Number(String(s.k).replace(",", ".")) }));
      if (body.sizes.some((s) => !Number.isFinite(s.priceK))) return bad("Коэффициент размера — число, например 1,345.");
    } else {
      body.sizes = sizes.map((s) => ({ code: s.code, unitPriceKop: toKop(s.unit) }));
      if (body.sizes.some((s) => !Number.isFinite(s.unitPriceKop))) return bad("Цена отпечатка — число, например 1,30.");
    }
    const o = toKop(old);
    if (Number.isNaN(o)) return bad("Старая цена — число или пусто.");
    body.oldPriceKop = o;
    setState({ busy: true, error: "", ok: "" });
    const r = await callApi(`/api/v1/admin/catalog/${product.slug}`, { method: "PATCH", body });
    if (!r.ok) return bad(r.error?.message || "Не получилось сохранить.");
    setState({ busy: false, error: "", ok: r.changed?.length ? `Сохранено: изменений ${r.changed.length}. Клиенты увидят новые цены в течение минуты.` : "Изменений нет." });
    router.refresh();
  }

  const id = (k) => `${product.slug}-${k}`;
  return (
    <form onSubmit={save} noValidate data-testid={`catalog-form-${product.slug}`}>
      <div className="catalog-fields">
        {isBook && (
          <>
            <label className="field" htmlFor={id("base")}>
              <span>Цена «от», BYN</span>
              <input id={id("base")} className="input" inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} />
            </label>
            <label className="field" htmlFor={id("per2")}>
              <span>За 2 страницы, BYN</span>
              <input id={id("per2")} className="input" inputMode="decimal" value={per2} onChange={(e) => setPer2(e.target.value)} />
            </label>
          </>
        )}
        <label className="field" htmlFor={id("badge")}>
          <span>Плашка</span>
          <select id={id("badge")} className="input" value={badge} onChange={(e) => setBadge(e.target.value)}>
            <option value="">без плашки</option>
            {badges.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
        <label className="field" htmlFor={id("old")}>
          <span>Старая цена «от», BYN</span>
          <input id={id("old")} className="input" inputMode="decimal" value={old} onChange={(e) => setOld(e.target.value)} placeholder="нет" aria-describedby={id("old-hint")} />
          <span id={id("old-hint")} className="field-hint">
            Пусто — без скидки. Больше текущей — в каталоге она зачёркнута.
          </span>
        </label>
      </div>
      <div className="table-wrap catalog-sizes">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Размер</th>
              <th scope="col" className="num">
                {isBook ? "Коэффициент цены" : "Цена отпечатка, BYN"}
              </th>
            </tr>
          </thead>
          <tbody>
            {sizes.map((s) => (
              <tr key={s.code}>
                <th scope="row" style={{ fontWeight: 400 }}>
                  {s.code.replace("x", "×")} · {s.label}
                </th>
                <td className="num">
                  {isBook ? (
                    <input className="input" inputMode="decimal" aria-label={`Коэффициент для ${s.code}`} value={String(s.k).replace(".", ",")} onChange={(e) => setSize(s.code, "k", e.target.value)} />
                  ) : (
                    <input className="input" inputMode="decimal" aria-label={`Цена отпечатка ${s.code}, BYN`} value={s.unit} onChange={(e) => setSize(s.code, "unit", e.target.value)} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="admin-actions">
        <button className="btn btn-primary" type="submit" disabled={state.busy}>
          {state.busy ? "Сохраняю…" : "Сохранить"}
        </button>
        <p className={"small " + (state.error ? "err-text" : "ok-text")} role="status" aria-live="polite" style={{ margin: 0 }}>
          {state.error || state.ok}
        </p>
      </div>
    </form>
  );
}
