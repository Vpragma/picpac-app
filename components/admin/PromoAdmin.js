"use client";
// Админка → «Промокоды» (N8): плитки-итоги, фильтры, таблица со статистикой (применён раз, сумма заказов),
// форма «Новый промокод» / «Изменить», «Выключить» / «Включить». Удаления нет — только выключить.
// Роль admin проверяет сервер (GET/POST /api/v1/admin/promo, PATCH /api/v1/admin/promo/{code}), каждое действие — в журнале.
import { useCallback, useEffect, useMemo, useState } from "react";
import { callApi } from "../../lib/api";
import { KIND_LABELS, SEASON_LABELS, SEASONS, benefitText } from "../../lib/promo";
import "../promo/promo.css";

const byn = (kop) => (kop / 100).toFixed(2).replace(".", ",") + " BYN";
const STATUS = {
  active: ["ok", "Действует"],
  scheduled: ["pending", "Запланирован"],
  disabled: ["draft", "Выключен"],
  expired: ["closed", "Истёк"],
  exhausted: ["returned", "Лимит исчерпан"],
};
const FILTERS = [
  ["all", "Все"],
  ["active", "Действуют"],
  ["scheduled", "Запланированы"],
  ["disabled", "Выключены"],
  ["expired", "Истекли"],
];
const EMPTY = { code: "", label: "", kind: "percent", value: "10", minTotal: "", validFrom: "", validTo: "", maxUses: "", maxUsesPerUser: "", productSlugs: [], season: "", active: true };

const dayText = (d) => (d ? d.split("-").reverse().join(".") : "");
const toKop = (s) => Math.round(Number(String(s).replace(",", ".").trim() || 0) * 100);
const fromKop = (k) => (k ? String(k / 100).replace(".", ",") : "");

export default function PromoAdmin() {
  const [type, setType] = useState("general");
  const [filter, setFilter] = useState("all");
  const [res, setRes] = useState(null);
  const [form, setForm] = useState(null); // { mode: "new" | "edit", data, errors, message }
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    const r = await callApi(`/api/v1/admin/promo?type=${type}`, { method: "GET" });
    setRes(r);
  }, [type]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- загрузка списка при смене вкладки
    load();
  }, [load]);

  const items = useMemo(() => {
    const list = res?.items || [];
    return filter === "all" ? list : list.filter((i) => i.status === filter);
  }, [res, filter]);
  const products = res?.products || [];
  const productName = (slug) => {
    const p = products.find((x) => x.slug === slug);
    return p ? (p.kind === "book" ? "Фотокнига " + p.name : p.name) : slug;
  };

  function startNew() {
    setToast(null);
    setForm({ mode: "new", data: { ...EMPTY }, errors: {}, message: null });
  }
  function startEdit(p) {
    setToast(null);
    setForm({
      mode: "edit",
      data: {
        code: p.code,
        label: p.label || "",
        kind: p.kind,
        value: p.kind === "amount" ? fromKop(p.value) : String(p.value || ""),
        minTotal: fromKop(p.minTotalKop),
        validFrom: p.validFrom || "",
        validTo: p.validTo || "",
        maxUses: p.maxUses ?? "",
        maxUsesPerUser: p.maxUsesPerUser ?? "",
        productSlugs: p.productSlugs || [],
        season: p.season || "",
        active: p.active,
      },
      errors: {},
      message: null,
    });
  }
  const set = (patch) => setForm((f) => ({ ...f, data: { ...f.data, ...patch }, errors: {} }));

  async function save(e) {
    e.preventDefault();
    const d = form.data;
    const value = d.kind === "percent" ? Math.round(Number(d.value)) : d.kind === "amount" ? toKop(d.value) : 0;
    const body = {
      kind: d.kind,
      value: Number.isFinite(value) ? value : -1,
      minTotalKop: toKop(d.minTotal),
      validFrom: d.validFrom || null,
      validTo: d.validTo || null,
      maxUses: d.maxUses === "" ? null : Number(d.maxUses),
      maxUsesPerUser: d.maxUsesPerUser === "" ? null : Number(d.maxUsesPerUser),
      productSlugs: d.productSlugs,
      season: d.season || null,
      label: d.label.trim(),
      active: d.active,
    };
    if (form.mode === "new") body.code = d.code.trim().toUpperCase();
    setBusy(true);
    const r =
      form.mode === "new"
        ? await callApi("/api/v1/admin/promo", { body })
        : await callApi(`/api/v1/admin/promo/${encodeURIComponent(d.code)}`, { method: "PATCH", body });
    setBusy(false);
    if (!r.ok) {
      setForm((f) => ({ ...f, errors: r.error?.fields || {}, message: r.error?.message || "Не получилось сохранить. Попробуйте ещё раз." }));
      return;
    }
    setForm(null);
    setToast(form.mode === "new" ? `Промокод ${r.promo.code} создан.` : `Промокод ${r.promo.code} сохранён.`);
    load();
  }

  async function toggle(p) {
    setBusy(true);
    const r = await callApi(`/api/v1/admin/promo/${encodeURIComponent(p.code)}`, { method: "PATCH", body: { active: !p.active } });
    setBusy(false);
    setToast(r.ok ? (p.active ? `Промокод ${p.code} выключен — он сразу перестал действовать.` : `Промокод ${p.code} включён.`) : r.error?.message || "Не получилось.");
    if (r.ok) load();
  }

  const s = res?.summary;
  return (
    <div className="promo-admin">
      <p className="muted small">
        Коды применяются в корзине; скидку, сроки и лимиты проверяет сервер. Удалить код нельзя — только выключить: история применений сохраняется.
      </p>
      {s && (
        <div className="stat-tiles" data-testid="promo-tiles">
          <div className="stat-tile">
            <span className="muted small">Действуют</span>
            <b>{s.activeCodes ?? "—"}</b>
          </div>
          <div className="stat-tile">
            <span className="muted small">Применений</span>
            <b>{s.uses}</b>
          </div>
          <div className="stat-tile">
            <span className="muted small">Сумма заказов с кодами</span>
            <b>{byn(s.totalKop)}</b>
          </div>
          <div className="stat-tile">
            <span className="muted small">Скидки клиентам</span>
            <b>{byn(s.discountKop)}</b>
          </div>
          <div className="stat-tile">
            <span className="muted small">Открытки: выдано / применено</span>
            <b>
              {s.cardsIssued} / {s.cardsUsed}
            </b>
          </div>
        </div>
      )}

      <div className="row between wrap" style={{ gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
        <div className="filters" role="group" aria-label="Какие коды показать">
          <button type="button" className="filter-chip" aria-pressed={type === "general"} onClick={() => setType("general")}>
            Общие коды
          </button>
          <button type="button" className="filter-chip" aria-pressed={type === "personal"} onClick={() => setType("personal")}>
            Личные (открытки)
          </button>
        </div>
        {type === "general" && !form && (
          <button type="button" className="btn btn-primary btn-small" onClick={startNew}>
            Новый промокод
          </button>
        )}
      </div>

      {toast && (
        <p className="note note-ok" role="status">
          {toast}
        </p>
      )}

      {form && (
        <form className="card promo-form" onSubmit={save} aria-labelledby="promo-form-title" noValidate>
          <h2 id="promo-form-title" className="admin-h">
            {form.mode === "new" ? "Новый промокод" : `Изменить ${form.data.code}`}
          </h2>
          {form.message && (
            <p className="note note-error" role="alert">
              {form.message}
            </p>
          )}
          <div className="promo-grid">
            {form.mode === "new" && (
              <Field label="Код" error={form.errors.code} hint="3–20 латинских букв и цифр, например OSEN2026">
                <input className="input" value={form.data.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} maxLength={20} required autoComplete="off" />
              </Field>
            )}
            <Field label="Описание для клиента" error={form.errors.label} hint="Видно в корзине, например «−15% на фотокниги осенью»">
              <input className="input" value={form.data.label} onChange={(e) => set({ label: e.target.value })} maxLength={120} />
            </Field>
          </div>
          <fieldset className="promo-fieldset">
            <legend>Тип скидки</legend>
            <div className="segmented">
              {Object.entries(KIND_LABELS).map(([k, label]) => (
                <label key={k}>
                  <input type="radio" name="kind" value={k} checked={form.data.kind === k} onChange={() => set({ kind: k })} />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="promo-grid">
            {form.data.kind !== "free_delivery" && (
              <Field label={form.data.kind === "percent" ? "Скидка, %" : "Скидка, BYN"} error={form.errors.value}>
                <input className="input" inputMode="decimal" value={form.data.value} onChange={(e) => set({ value: e.target.value })} required />
              </Field>
            )}
            <Field label="Минимальная сумма заказа, BYN" error={form.errors.minTotalKop} hint="Пусто — без минимума">
              <input className="input" inputMode="decimal" value={form.data.minTotal} onChange={(e) => set({ minTotal: e.target.value })} />
            </Field>
            <Field label="Действует с" error={form.errors.validFrom}>
              <input className="input" type="date" value={form.data.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
            </Field>
            <Field label="Действует по" error={form.errors.validTo} hint="Включительно, по Минску">
              <input className="input" type="date" value={form.data.validTo} onChange={(e) => set({ validTo: e.target.value })} />
            </Field>
            <Field label="Лимит применений всего" error={form.errors.maxUses} hint="Пусто — без лимита">
              <input className="input" inputMode="numeric" value={form.data.maxUses} onChange={(e) => set({ maxUses: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Лимит на одного клиента" error={form.errors.maxUsesPerUser} hint="1 — один раз на клиента">
              <input className="input" inputMode="numeric" value={form.data.maxUsesPerUser} onChange={(e) => set({ maxUsesPerUser: e.target.value.replace(/\D/g, "") })} />
            </Field>
            <Field label="Сезон" error={form.errors.season} hint="Сезонный код работает, только когда включён его сезон">
              <select className="input" value={form.data.season} onChange={(e) => set({ season: e.target.value })}>
                <option value="">Без сезона</option>
                {SEASONS.map((x) => (
                  <option key={x} value={x}>
                    {SEASON_LABELS[x]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <fieldset className="promo-fieldset">
            <legend>К каким продуктам относится</legend>
            <p className="field-hint" style={{ marginTop: 0 }}>
              Ничего не выбрано — ко всем продуктам.
            </p>
            <div className="promo-products">
              {products.map((p) => (
                <label key={p.slug} className="check-chip">
                  <input
                    type="checkbox"
                    checked={form.data.productSlugs.includes(p.slug)}
                    onChange={(e) => set({ productSlugs: e.target.checked ? [...form.data.productSlugs, p.slug] : form.data.productSlugs.filter((x) => x !== p.slug) })}
                  />
                  {productName(p.slug)}
                </label>
              ))}
            </div>
            {form.errors.productSlugs && <span className="field-error">{form.errors.productSlugs}</span>}
          </fieldset>
          <label className="row switch-row">
            <input type="checkbox" role="switch" checked={form.data.active} onChange={(e) => set({ active: e.target.checked })} />
            <span>Включён — код можно применить</span>
          </label>
          <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-primary" disabled={busy} aria-busy={busy}>
              {busy ? "Сохраняем…" : "Сохранить"}
            </button>
            <button type="button" className="btn" onClick={() => setForm(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {type === "general" && (
        <div className="filters" role="group" aria-label="Статус кода" style={{ marginBottom: "var(--space-3)" }}>
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" className="filter-chip" aria-pressed={filter === id} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {!res ? (
        <p className="muted">Загружаем промокоды…</p>
      ) : !res.ok ? (
        <p className="note note-error" role="alert">
          {res.error?.message || "Не получилось загрузить промокоды."}{" "}
          <button type="button" className="btn btn-small" onClick={load}>
            Повторить
          </button>
        </p>
      ) : !items.length ? (
        <p className="muted">{type === "personal" ? "Открыток с личными кодами пока нет — они появляются после каждого заказа." : "Кодов с таким статусом нет."}</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table promo-table" data-testid="promo-table">
            <thead>
              <tr>
                <th scope="col">Код</th>
                <th scope="col">Скидка и условия</th>
                <th scope="col">Срок</th>
                <th scope="col">Статус</th>
                <th scope="col" className="num">
                  Применён
                </th>
                <th scope="col" className="num">
                  Сумма заказов
                </th>
                <th scope="col">
                  <span className="visually-hidden">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const [chip, statusLabel] = STATUS[p.status] || ["draft", p.status];
                return (
                  <tr key={p.code} data-code={p.code}>
                    <td>
                      <span className="chip promo-code">{p.code}</span>
                      {p.personal && p.sourceOrder && <div className="muted small">к заказу {p.sourceOrder}</div>}
                    </td>
                    <td>
                      <b>{benefitText(p)}</b>
                      {p.label && <div className="small">{p.label}</div>}
                      <div className="muted small">
                        {[
                          p.minTotalKop ? `от ${byn(p.minTotalKop)}` : null,
                          p.productSlugs.length ? p.productSlugs.map(productName).join(", ") : null,
                          p.season ? `сезон «${SEASON_LABELS[p.season]}»` : null,
                          p.maxUses != null ? `всего до ${p.maxUses}` : null,
                          p.maxUsesPerUser != null ? `на клиента до ${p.maxUsesPerUser}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "без ограничений"}
                      </div>
                    </td>
                    <td className="small">
                      {p.validFrom || p.validTo ? `${p.validFrom ? "с " + dayText(p.validFrom) : ""}${p.validTo ? " по " + dayText(p.validTo) : ""}`.trim() : "бессрочно"}
                    </td>
                    <td>
                      <span className="chip status-chip" data-status={chip}>
                        {statusLabel}
                      </span>
                    </td>
                    <td className="num">
                      {p.stats.uses}
                      {p.stats.users > 0 && <div className="muted small">клиентов: {p.stats.users}</div>}
                    </td>
                    <td className="num">
                      {byn(p.stats.totalKop)}
                      {p.stats.discountKop > 0 && <div className="muted small">скидка {byn(p.stats.discountKop)}</div>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: "var(--space-1)", justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {!p.personal && (
                          <button type="button" className="btn btn-small" onClick={() => startEdit(p)} aria-label={`Изменить ${p.code}`}>
                            Изменить
                          </button>
                        )}
                        <button type="button" className="btn btn-small" onClick={() => toggle(p)} disabled={busy} aria-label={`${p.active ? "Выключить" : "Включить"} ${p.code}`}>
                          {p.active ? "Выключить" : "Включить"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {res?.truncated && <p className="muted small">Показаны последние 200 открыток.</p>}
    </div>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && !error && <small className="field-hint">{hint}</small>}
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
    </label>
  );
}
