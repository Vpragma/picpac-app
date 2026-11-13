"use client";
// Очередь модерации (D4 → N4, N9): фото по подписанной ссылке (10 минут) размыто до «Показать»; вывод модели — словами
// («Найдено: обнажённая грудь (высокая уверенность)»), без процентов; клиент — только инициалы.
// «Одобрить» или «Вернуть на замену» с причиной из списка и шаблоном комментария. Клавиши на компьютере:
// A — одобрить, R — вернуть, N — следующее, S — показать фото, Esc — отмена (можно выключить). Вверху — сколько ждёт
// и среднее время проверки, вкладка «История решений» — решение модели и модератора без фото. Опрос раз в 30 с.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { callApi } from "../../lib/api";
import { REASON_FOR_FINDING, RETURN_REASONS, RETURN_TEMPLATES } from "../../lib/moderation";
import { minskTime } from "../OrderBits";
import { plural } from "../../lib/plural";
import { BLUR_STYLE } from "./moderationBlur";

const SOURCE = { server: "по проверке на сервере", device: "по проверке на телефоне клиента" };
const KEYS = { approve: ["a", "ф"], ret: ["r", "к"], next: ["n", "т", "j", "о"], show: ["s", "ы"] };
const min = (v) => (v == null ? "—" : v < 1 ? "меньше минуты" : `${Math.round(v)} мин`);

function Findings({ item }) {
  if (!item.findings?.length) {
    return (
      <p className="small muted" style={{ margin: 0 }} data-testid="moderation-findings">
        Модель ничего не нашла: фото помечено вручную или старой проверкой. Посмотрите сами.
      </p>
    );
  }
  return (
    <div data-testid="moderation-findings">
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {item.findings.map((f) => (
          <li key={f.id} className={f.level === "high" ? "err-text" : "warn-text"}>
            {f.text}
          </li>
        ))}
      </ul>
      {SOURCE[item.source] && <p className="small muted" style={{ margin: "4px 0 0" }}>{SOURCE[item.source]}. Решение за вами — автоматика никогда не отклоняет.</p>}
    </div>
  );
}

// onStart — решение отправлено: карточку убираем из списка сразу (N7), onFail — сервер не принял: возвращаем её
const Card = forwardRef(function Card({ item, active, onActivate, onDone, onStart = () => {}, onFail = () => {} }, ref) {
  const [mode, setMode] = useState(null); // null | "return"
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [show, setShow] = useState(false);
  const box = useRef(null);
  const select = useRef(null);

  async function decide(decision) {
    if (busy) return;
    setError("");
    if (decision === "return" && !reason) return setError("Выберите причину возврата.");
    setBusy(true);
    onStart(item.id);
    const r = await callApi(`/api/v1/admin/moderation/${item.id}`, { body: { decision, ...(decision === "return" ? { reason, comment: comment.trim() || undefined } : {}) } });
    setBusy(false);
    if (!r.ok) {
      const text = r.error?.fields?.reason || r.error?.message || "Не получилось сохранить решение.";
      setError(text);
      return onFail(item.id, `Заказ ${item.orderNumber}, фото № ${(item.photoIndex ?? 0) + 1}: ${text}`);
    }
    onDone(decision === "approve" ? `Фото из заказа ${item.orderNumber} одобрено${r.waiting ? "" : " — заказ ушёл в производство"}.` : `Фото из заказа ${item.orderNumber} возвращено на замену.`);
  }

  function pickReason(next) {
    // Шаблон комментария: подставляем, если поле пустое или в нём шаблон прошлой причины
    if (!comment.trim() || comment === (RETURN_TEMPLATES[reason] || "")) setComment(RETURN_TEMPLATES[next] || "");
    setReason(next);
  }

  function openReturn() {
    if (!reason) {
      const hint = REASON_FOR_FINDING[item.findings?.[0]?.id] || "";
      if (hint) {
        setReason(hint);
        if (!comment.trim()) setComment(RETURN_TEMPLATES[hint] || "");
      }
    }
    setMode("return");
    setTimeout(() => select.current?.focus(), 0);
  }

  useImperativeHandle(ref, () => ({
    approve: () => mode !== "return" && decide("approve"),
    ret: openReturn,
    toggle: () => setShow((v) => !v),
    cancel: () => setMode(null),
    focus: () => {
      box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      box.current?.focus({ preventScroll: true });
    },
  }));

  return (
    <section
      ref={box}
      tabIndex={-1}
      className="card stack"
      data-testid="moderation-item"
      aria-current={active ? "true" : undefined}
      onFocus={onActivate}
      onClick={onActivate}
      style={{ outline: active ? "2px solid var(--ds-color-accent)" : undefined, outlineOffset: 2 }}
    >
      <div className="row between wrap">
        <b>
          Заказ {item.orderNumber} · фото № {(item.photoIndex ?? 0) + 1}
        </b>
        <span className="muted small">
          ждёт с {minskTime(item.createdAt)} · клиент {item.client?.name || "—"}
        </span>
      </div>
      <Findings item={item} />
      <div className="row wrap" style={{ alignItems: "flex-start" }}>
        {item.url ? (
          <div style={{ position: "relative", width: "100%", maxWidth: 360, borderRadius: 8, overflow: "hidden" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- подписанная ссылка на 10 минут, оптимизатор не нужен */}
            <img
              src={item.url}
              alt={show ? `Фото на проверке, заказ ${item.orderNumber}` : `Фото на проверке скрыто размытием, заказ ${item.orderNumber}`}
              data-testid="moderation-photo"
              data-blurred={show ? "false" : "true"}
              style={{ display: "block", width: "100%", ...(show ? {} : BLUR_STYLE) }}
            />
          </div>
        ) : (
          <p className="muted small">Файл фото недоступен.</p>
        )}
      </div>
      <button type="button" className="btn btn-small" onClick={() => setShow((v) => !v)} aria-pressed={show} data-testid="moderation-show">
        {show ? "Скрыть фото" : "Показать фото"}
      </button>
      {error && (
        <p className="err-text" role="alert">
          {error}
        </p>
      )}
      {mode === "return" ? (
        <div className="stack">
          <label className="field">
            <span>Причина (обязательно)</span>
            <select ref={select} className="input" value={reason} onChange={(e) => pickReason(e.target.value)} aria-invalid={!!error && !reason}>
              <option value="">— выберите —</option>
              {Object.entries(RETURN_REASONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Комментарий для клиента (шаблон можно поправить)</span>
            <textarea className="input" rows={3} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} style={{ fontFamily: "inherit" }} />
          </label>
          <div className="row wrap">
            <button type="button" className="btn btn-primary" onClick={() => decide("return")} disabled={busy}>
              {busy ? "Сохраняем…" : "Вернуть на замену"}
            </button>
            <button type="button" className="btn" onClick={() => setMode(null)} disabled={busy}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <div className="row wrap">
          <button type="button" className="btn btn-primary" onClick={() => decide("approve")} disabled={busy}>
            {busy ? "Сохраняем…" : "Одобрить"}
          </button>
          <button type="button" className="btn" onClick={openReturn} disabled={busy}>
            Вернуть на замену
          </button>
        </div>
      )}
    </section>
  );
});

function Stats({ stats }) {
  if (!stats) return null;
  return (
    <section className="stat-tiles" aria-label="Очередь коротко" data-testid="moderation-stats">
      {/* N7: то же число, что плитка «Фото ждут проверки» в «Обзоре» (lib/server/moderationCounts.js) */}
      <div className="stat-tile" data-testid="moderation-waiting" data-value={stats.pending}>
        <span className="small muted">Фото ждут проверки</span>
        <b>{stats.pending}</b>
        {stats.orders != null && <span className="small muted">{stats.pending ? `в ${stats.orders} ${plural(stats.orders, "заказе", "заказах", "заказах")} · сейчас` : "сейчас"}</span>}
      </div>
      <div className="stat-tile">
        <span className="small muted">Среднее время проверки (7 дней)</span>
        <b>{min(stats.avgMinutes)}</b>
      </div>
      <div className="stat-tile">
        <span className="small muted">Решений за сутки</span>
        <b>{stats.decided24h}</b>
      </div>
    </section>
  );
}

function History({ onStats }) {
  const [res, setRes] = useState(null);
  useEffect(() => {
    let alive = true;
    callApi("/api/v1/admin/moderation?view=history", { method: "GET" }).then((r) => {
      if (!alive) return;
      setRes(r);
      if (r.ok && r.stats) onStats(r.stats);
    });
    return () => {
      alive = false;
    };
  }, [onStats]);
  if (!res) return <p className="muted">Загружаем историю…</p>;
  if (!res.ok) return <p className="err-text">{res.error?.message || "Не получилось загрузить историю."}</p>;
  if (!res.items.length) return <p className="muted">Решений пока нет.</p>;
  return (
    <div style={{ overflowX: "auto" }} data-testid="moderation-history">
      <table className="stat-table">
        <thead>
          <tr>
            <th scope="col">Когда</th>
            <th scope="col">Заказ</th>
            <th scope="col">Модель</th>
            <th scope="col">Решение модератора</th>
            <th scope="col">Проверка</th>
          </tr>
        </thead>
        <tbody>
          {res.items.map((h) => (
            <tr key={h.id}>
              <td>{minskTime(h.decidedAt)}</td>
              <td>
                {h.orderNumber}, фото № {(h.photoIndex ?? 0) + 1}
              </td>
              <td>{h.findings.length ? h.findings.map((f) => f.text).join("; ") : "ничего не нашла"}</td>
              <td>
                {h.decision === "approved" ? "Одобрено" : `Возвращено: ${h.reasonText || "—"}`}
                {h.byMe ? " · вы" : ""}
              </td>
              <td>{min(h.minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ModerationQueue() {
  const [tab, setTab] = useState("queue");
  const [res, setRes] = useState(null);
  const [note, setNote] = useState("");
  const [active, setActive] = useState(0);
  const [keys, setKeys] = useState(true);
  const [desktop, setDesktop] = useState(false);
  const [stats, setStats] = useState(null);
  const [hidden, setHidden] = useState(() => new Set()); // N7: решение отправлено — карточки уже нет в списке
  const [noteError, setNoteError] = useState(false);
  const cards = useRef({});
  const load = useCallback(async () => {
    const r = await callApi("/api/v1/admin/moderation", { method: "GET" });
    setRes(r);
    if (r.ok && r.stats) setStats(r.stats);
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => alive && load();
    tick();
    const t = setInterval(tick, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [load]);

  useEffect(() => {
    const m = window.matchMedia("(hover: hover) and (pointer: fine)");
    const upd = () => setDesktop(m.matches);
    upd();
    m.addEventListener?.("change", upd);
    return () => m.removeEventListener?.("change", upd);
  }, []);

  const items = useMemo(() => (res?.ok ? res.items.filter((it) => !hidden.has(it.id)) : []), [res, hidden]);
  const hide = useCallback((id, on) =>
    setHidden((h) => {
      const next = new Set(h);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    }), []);
  const current = items[Math.min(active, Math.max(0, items.length - 1))];

  useEffect(() => {
    if (!keys || !desktop || tab !== "queue") return;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target;
      if (t?.closest?.("input, textarea, select, [contenteditable='true']")) {
        if (e.key === "Escape") cards.current[current?.id]?.cancel();
        return;
      }
      const k = (e.key || "").toLowerCase();
      if (!current) return;
      const card = cards.current[current.id];
      if (KEYS.approve.includes(k)) card?.approve();
      else if (KEYS.ret.includes(k)) card?.ret();
      else if (KEYS.show.includes(k)) card?.toggle();
      else if (k === "escape") card?.cancel();
      else if (KEYS.next.includes(k)) {
        const n = (Math.min(active, items.length - 1) + 1) % items.length;
        setActive(n);
        cards.current[items[n]?.id]?.focus();
      } else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keys, desktop, tab, current, active, items]);

  return (
    <div className="stack" data-testid="moderation-queue">
      <Stats stats={stats} />
      <div className="steps" role="tablist" aria-label="Модерация" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", maxWidth: 420 }}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "queue"}
          className={tab === "queue" ? "active" : ""}
          onClick={() => {
            setTab("queue");
            load();
          }}
        >
          Очередь{stats ? ` (${stats.pending})` : ""}
        </button>
        <button type="button" role="tab" aria-selected={tab === "history"} className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>
          История решений
        </button>
      </div>
      {tab === "history" ? (
        <History onStats={setStats} />
      ) : (
        <>
          {desktop && (
            <div className="row wrap small muted" data-testid="moderation-keys">
              <span>
                Клавиши: <kbd>A</kbd> — одобрить · <kbd>R</kbd> — вернуть · <kbd>N</kbd> — следующее · <kbd>S</kbd> — показать фото · <kbd>Esc</kbd> — отмена
              </span>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={keys} onChange={(e) => setKeys(e.target.checked)} /> включены
              </label>
            </div>
          )}
          {note && (
            <p className={noteError ? "err-text" : "ok-text"} role={noteError ? "alert" : "status"}>
              {note}
            </p>
          )}
          {!res && <p className="muted">Загружаем очередь…</p>}
          {res && !res.ok && <p className="err-text">{res.error?.message || "Не получилось загрузить очередь."}</p>}
          {res?.ok && !items.length && <p className="muted">Очередь пуста — все фото проверены.</p>}
          {items.map((it, i) => (
            <Card
              key={it.id}
              ref={(el) => {
                if (el) cards.current[it.id] = el;
                else delete cards.current[it.id];
              }}
              item={it}
              active={desktop && current?.id === it.id}
              onActivate={() => setActive(i)}
              onStart={(id) => hide(id, true)}
              onFail={(id, text) => {
                hide(id, false);
                setNoteError(true);
                setNote(text);
              }}
              onDone={(text) => {
                setNoteError(false);
                setNote(text);
                load();
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}
