// Админка → карточка заказа (только админ). N9: всё в одном месте — суммы и доставка, состав с миниатюрами,
// лента статусов с причинами, решение модерации, переписка с клиентом, история действий из журнала.
// Данные клиента замаскированы (SEC-14). Читаем сервисным ключом после проверки роли; журнал — от имени админа (RLS).
import Link from "next/link";
import { notFound } from "next/navigation";
import OrderStatusForm from "@/components/admin/OrderStatusForm";
import { StatusChip } from "@/components/OrderBits";
import { ACTION_LABELS, RESULT_LABELS } from "@/lib/auditLabels";
import { EVENT_LABELS, progressFor } from "@/lib/erp";
import { maskClient } from "@/lib/mask";
import { ROLE_LABELS } from "@/lib/roles";
import { loadCatalog } from "@/lib/server/catalog";
import { STATUS_LABELS } from "@/lib/server/orders";
import { requirePageRole } from "@/lib/server/session";
import { createSupabaseAdmin } from "@/lib/server/supabaseAdmin";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const time = (iso) => (iso ? new Date(iso).toLocaleString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const byn = (kop) => (Math.round(kop || 0) / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " BYN";
const SOURCE = { erp: "ERP", admin: "сотрудник", system: "система" };
const THUMBS_PER_ITEM = 12;
const AUTHOR = { client: "Клиент", bot: "Бот", operator: "Оператор" };
const IT_STATUS = { open: "Ждёт ответа", answered: "Есть ответ", closed: "Закрыто" };
const DECISION = { pending: "Ждёт проверки", approved: "Одобрено", rejected: "Отклонено", returned: "Вернули на замену" };
const PAY = { card_test: "карта (тест)", erip_test: "ЕРИП (тест)" };

// A8: миниатюры состава — первые фото каждой позиции по подписанным ссылкам на 10 минут (бакет приватный)
async function signThumbs(db, items) {
  const paths = [];
  for (const it of items) for (const p of (it.snapshot?.photos || []).slice(0, THUMBS_PER_ITEM)) if (p?.path) paths.push(p.path);
  const urls = {};
  if (paths.length) {
    const { data } = await db.storage.from("photos").createSignedUrls(paths, 600);
    for (const r of data || []) if (r.signedUrl && !r.error) urls[r.path] = r.signedUrl;
  }
  return urls;
}

export default async function AdminOrderPage({ params }) {
  const { id } = await params;
  const auth = await requirePageRole(["admin"], `/admin/orders/${id}`);
  if (!UUID_RE.test(id)) notFound();
  const db = createSupabaseAdmin();
  const { data: o } = await db
    .from("orders")
    .select(
      "id, number, status, substatus, erp_stage, recipient, delivery_code, delivery_address, goods_kop, discount_kop, delivery_kop, total_kop, promo_code, payment_method, payment_status, paid_at, is_demo, is_synthetic, created_at, status_changed_at, eta_from, eta_to",
    )
    .eq("id", id)
    .maybeSingle();
  if (!o) notFound();
  const [{ data: history }, { data: items }, { data: interactions }, { data: reviews }, { data: auditRows }, catalog] = await Promise.all([
    db.from("order_status_history").select("id, status, substatus, at, source, reason, event_type").eq("order_id", id).order("at").order("id"),
    db.from("order_items").select("id, title, product_slug, quantity, unit_price_kop, line_total_kop, snapshot").eq("order_id", id),
    db.from("interactions").select("id, topic, kind, status, created_at, sla_due").eq("order_id", id).order("created_at"),
    db.from("moderation_reviews").select("id, decision, reason, comment, auto_flag, photo_index, created_at, decided_at").eq("order_id", id).order("created_at"),
    // История действий по заказу — от имени админа (правило RLS журнала)
    auth.supabase.from("audit_log_view").select("id, at, role, action, result, details").eq("object_type", "order").eq("object_id", o.number).order("id", { ascending: false }).limit(20),
    loadCatalog().catch(() => ({ products: [], delivery: [] })),
  ]);
  const itIds = (interactions || []).map((i) => i.id);
  const { data: messages } = itIds.length
    ? await db.from("interaction_messages").select("id, interaction_id, author_kind, body, created_at").in("interaction_id", itIds).order("created_at").limit(200)
    : { data: [] };
  const client = maskClient(o, "admin");
  const thumbs = await signThumbs(db, items || []);
  const names = Object.fromEntries(catalog.products.map((p) => [p.slug, p.name]));
  const delivery = catalog.delivery?.find((d) => d.code === o.delivery_code);
  const overdue = ["accepted", "moderation", "production"].includes(o.status) && o.eta_to && new Date(o.eta_to) < new Date();
  const decided = (reviews || []).filter((r) => r.decision !== "pending");
  const pending = (reviews || []).length - decided.length;

  return (
    <div>
      <Link href="/admin/orders" className="back-link">
        ← Заказы
      </Link>
      <div className="row between wrap" style={{ marginTop: 8 }}>
        <h1 style={{ margin: 0, fontSize: "1.5rem" }}>№ {o.number}</h1>
        <StatusChip status={o.status} />
      </div>
      <p className="muted small">
        {o.substatus || STATUS_LABELS[o.status]} · готовность {progressFor(o.status, o.erp_stage)} % · {o.payment_status === "paid_test" ? "оплачен (тест)" : "не оплачен"}
        {overdue ? " · " : ""}
        {overdue ? <b className="err-text">срок готовности прошёл</b> : null}
        {o.is_demo ? " · демо" : ""}
        {o.is_synthetic ? " · синтетика" : ""}
      </p>

      <div className="order-grid">
        <section className="card" aria-labelledby="sum-h">
          <h2 id="sum-h" className="admin-h">
            Заказ и оплата
          </h2>
          <dl className="order-sums small" data-testid="admin-order-sums">
            <div>
              <dt>Создан</dt>
              <dd>{time(o.created_at)}</dd>
            </div>
            <div>
              <dt>Товары</dt>
              <dd>{byn(o.goods_kop)}</dd>
            </div>
            {o.discount_kop > 0 && (
              <div>
                <dt>Скидка{o.promo_code ? ` (${o.promo_code})` : ""}</dt>
                <dd>−{byn(o.discount_kop)}</dd>
              </div>
            )}
            <div>
              <dt>Доставка{delivery ? ` · ${delivery.name}` : ""}</dt>
              <dd>{o.delivery_kop ? byn(o.delivery_kop) : "бесплатно"}</dd>
            </div>
            <div className="total">
              <dt>Итого</dt>
              <dd>{byn(o.total_kop)}</dd>
            </div>
            <div>
              <dt>Оплата</dt>
              <dd>{o.payment_status === "paid_test" ? `${PAY[o.payment_method] || "тест"}, ${time(o.paid_at)}` : "не оплачен"}</dd>
            </div>
            <div>
              <dt>Готовность (срок)</dt>
              <dd>{o.eta_to ? `${time(o.eta_from) || "—"} — ${time(o.eta_to)}` : "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="card" aria-labelledby="client-h">
          <h2 id="client-h" className="admin-h">
            Клиент (данные скрыты)
          </h2>
          <p className="small" style={{ margin: 0 }} data-testid="masked-client">
            {client.name || "—"} · {client.phone || "—"} · {client.email || "—"}
            {client.address ? ` · ${client.address}` : ""}
          </p>
          <p className="muted small">Данные клиента скрыты: полные контакты и адрес видит только служба доставки.</p>
          <h3 className="admin-h" style={{ marginTop: 12 }}>
            Сменить статус вручную
          </h3>
          <OrderStatusForm orderId={o.id} current={o.status} />
        </section>
      </div>

      <section className="card" aria-labelledby="items-h">
        <h2 id="items-h" className="admin-h">
          Состав
        </h2>
        {(items || []).map((i) => {
          const photos = i.snapshot?.photos || [];
          const count = i.snapshot?.photoCount ?? photos.length;
          const shown = photos.slice(0, THUMBS_PER_ITEM);
          return (
            <div key={i.id} style={{ marginBottom: 12 }}>
              <div className="sum-line small">
                <span>
                  <b>{names[i.product_slug] || i.product_slug}</b>
                  {i.title ? ` · «${i.title}»` : ""}
                  {i.quantity > 1 ? ` × ${i.quantity}` : ""}
                  <span className="muted"> · {count} фото</span>
                </span>
                <span>{byn(i.line_total_kop)}</span>
              </div>
              {!!shown.length && (
                <ul className="admin-thumbs" aria-label={`Фото позиции «${i.title || names[i.product_slug] || ""}»`} data-testid="admin-order-thumbs">
                  {shown.map((p, n) => (
                    <li key={p.id || n}>
                      {thumbs[p.path] ? (
                        // eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка на 10 минут на фото клиента, оптимизатор не нужен
                        <img src={thumbs[p.path]} alt={`Фото ${n + 1}`} width="72" height="72" loading="lazy" />
                      ) : (
                        <span className="admin-thumb-empty" title="Фото недоступно" />
                      )}
                    </li>
                  ))}
                  {count > shown.length && <li className="muted small admin-thumbs-more">и ещё {count - shown.length}</li>}
                </ul>
              )}
            </div>
          );
        })}
      </section>

      <div className="order-grid">
        <section className="card" aria-labelledby="hist-h">
          <h2 id="hist-h" className="admin-h">
            Лента статусов
          </h2>
          <ol className="stack small" style={{ paddingLeft: 18, margin: 0 }} data-testid="admin-history">
            {(history || []).map((h) => (
              <li key={h.id}>
                <b>{STATUS_LABELS[h.status]}</b>
                {h.substatus ? ` · ${h.substatus}` : ""} <span className="muted">· {time(h.at)} · {SOURCE[h.source] || h.source}</span>
                {h.event_type ? <span className="muted"> · {EVENT_LABELS[h.event_type] || h.event_type}</span> : null}
                {h.reason ? <div style={{ overflowWrap: "anywhere" }}>Причина: {h.reason}</div> : null}
              </li>
            ))}
          </ol>
        </section>

        <section className="card" aria-labelledby="mod-h" data-testid="admin-order-moderation">
          <h2 id="mod-h" className="admin-h">
            Модерация
          </h2>
          {!reviews?.length ? (
            <p className="muted small">Проверка модератором не понадобилась — фото прошли автоматическую проверку.</p>
          ) : (
            <>
              <p className="small">
                {decided.length ? `Решений: ${decided.length}` : "Решений пока нет"}
                {pending ? ` · ждут проверки: ${pending}` : ""}.
              </p>
              <ul className="stack small" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {reviews.map((r) => (
                  <li key={r.id}>
                    <span className="chip status-chip" data-status={r.decision}>
                      {DECISION[r.decision] || r.decision}
                    </span>
                    <span className="muted">
                      {" "}
                      · фото {r.photo_index != null ? r.photo_index + 1 : "—"} · {r.decided_at ? time(r.decided_at) : `на проверке с ${time(r.created_at)}`}
                      {r.auto_flag ? ` · автопроверка: ${r.auto_flag}` : ""}
                    </span>
                    {(r.comment || r.reason) && <div style={{ overflowWrap: "anywhere" }}>Комментарий: {r.comment || r.reason}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="small" style={{ marginTop: 8 }}>
            <Link href="/admin/moderation">Очередь модерации</Link>
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="chat-h" data-testid="admin-order-chat">
        <h2 id="chat-h" className="admin-h">
          Переписка с клиентом
        </h2>
        {!interactions?.length ? (
          <p className="muted small">Обращений по заказу нет.</p>
        ) : (
          interactions.map((it) => {
            const msgs = (messages || []).filter((m) => m.interaction_id === it.id);
            return (
              <div key={it.id} style={{ marginBottom: 12 }}>
                <div className="row between wrap small">
                  <b>
                    {it.topic}
                    {it.kind === "reprint" ? " · перепечатка" : ""}
                  </b>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="chip status-chip" data-status={it.status}>
                      {IT_STATUS[it.status] || it.status}
                    </span>
                    <Link href={`/admin/support/${it.id}`}>Ответить</Link>
                  </span>
                </div>
                {msgs.length ? (
                  <ol className="chat-log small" style={{ marginTop: 8 }}>
                    {msgs.map((m) => (
                      <li key={m.id} className={m.author_kind === "client" ? "client" : "staff"}>
                        <span className="meta">
                          {AUTHOR[m.author_kind] || m.author_kind} · {time(m.created_at)}
                        </span>
                        {m.body}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted small">Сообщений нет.</p>
                )}
              </div>
            );
          })
        )}
      </section>

      <section className="card" aria-labelledby="audit-h">
        <div className="row between wrap">
          <h2 id="audit-h" className="admin-h" style={{ margin: 0 }}>
            Действия по заказу
          </h2>
          <Link className="small" href={`/admin/audit?objectType=order&objectId=${encodeURIComponent(o.number)}&days=all&erp=1&system=1&tests=1`}>
            Весь журнал по заказу
          </Link>
        </div>
        {!auditRows?.length ? (
          <p className="muted small">Записей в журнале нет.</p>
        ) : (
          <ol className="audit-mini small" style={{ marginTop: 8 }}>
            {auditRows.map((a) => (
              <li key={a.id}>
                {time(a.at)} · {ACTION_LABELS[a.action] || a.action} · {RESULT_LABELS[a.result] || a.result}
                {a.role ? ` · ${ROLE_LABELS[a.role] || a.role}` : ""}
                {a.details?.from && a.details?.to ? ` · ${STATUS_LABELS[a.details.from] || a.details.from} → ${STATUS_LABELS[a.details.to] || a.details.to}` : ""}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
