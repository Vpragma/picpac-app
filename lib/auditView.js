// N9: удобный журнал действий — быстрые фильтры, «кто это» (люди, система, ERP, автотесты) и группировка
// одинаковых событий подряд («×12»). Чистые функции без доступа к базе: их используют сервер, экран и unit-тесты.
// Журнал не меняется и не удаляется — шум убирается только отображением (план ночи 2, раздел 0).

// Быстрые фильтры экрана журнала
export const AUDIT_QUICK = {
  logins: { label: "Входы", hint: "вход, выход, регистрация, выбор роли, код 2FA" },
  denied: { label: "Отказы", hint: "отказы в доступе, неверные пароли, ошибки" },
  status: { label: "Смены статуса", hint: "ручные смены статуса заказов сотрудником" },
  moderation: { label: "Модерация", hint: "очередь и решения модерации" },
  admin: { label: "Админские действия", hint: "роли, каталог, выгрузки, напоминания, ответы клиентам, смены статуса" },
};

// Админские действия: всё admin.* и эти действия сотрудника
export const ADMIN_ACTIONS = ["order.status_change", "interaction.reply"];

// Системные события (не люди): расписание и автоматические уведомления; ERP — отдельной галочкой
export const SYSTEM_PREFIXES = ["cron.", "notify."];
export const ERP_PREFIX = "erp.";

// Автотесты: служебные тестовые аккаунты (в том числе уже удалённые — признак is_test из базы),
// запросы с самого сервера, записи с пометкой test
export const TEST_EMAIL_RE = /^(e2e|critic|night2)-/i;
export function isTestRow(r) {
  if (r?.is_test === true) return true;
  return TEST_EMAIL_RE.test(String(r?.details?.email || "")) || r?.ip === "127.0.0.1" || r?.details?.test != null;
}

// Кто совершил действие: «test» | «erp» | «system» | «human»
export function auditActor(r) {
  if (isTestRow(r)) return "test";
  const a = String(r?.action || "");
  if (a.startsWith(ERP_PREFIX)) return "erp";
  if (SYSTEM_PREFIXES.some((p) => a.startsWith(p))) return "system";
  return "human";
}

// Периоды экрана журнала: дней назад от текущего момента (all — без ограничения)
export const AUDIT_PERIODS = { 1: "Сутки", 7: "7 дней", 30: "30 дней", all: "Всё время" };

// Одинаковые события подряд: то же действие, результат, роль, тот же человек (или IP гостя) и тип объекта.
// Номер объекта не учитываем: «Добавление фото ×30» — одна строка, по клику видно каждое фото.
export function auditGroupKey(r) {
  const who = r.user_id || (r.ip ? "ip:" + r.ip : "") || (r.details?.email ? "mail:" + r.details.email : "anon");
  return [r.action, r.result, r.role || "", who, r.object_type || ""].join("|");
}

// Строки (новые сверху) → группы подряд идущих одинаковых событий: [{ key, items }]
export function groupAudit(rows) {
  const groups = [];
  for (const r of rows || []) {
    const key = auditGroupKey(r);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, items: [r] });
  }
  return groups;
}

// Страница групп из окна строк. moreRows — в базе есть строки после окна.
// Возвращает { groups, next }: next — id, после которого продолжать (курсор «before»), или null.
// Последняя группа окна может продолжаться за его краем — её переносим на следующую страницу целиком
// (кроме случая, когда в окне всего одна группа: тогда показываем её как есть, курсор — её последняя строка).
export function pageGroups(rows, { pageSize = 50, moreRows = false } = {}) {
  const all = groupAudit(rows);
  if (all.length > pageSize) {
    const groups = all.slice(0, pageSize);
    return { groups, next: groups[groups.length - 1].items.at(-1).id };
  }
  if (!moreRows) return { groups: all, next: null };
  if (all.length > 1) {
    const groups = all.slice(0, -1);
    return { groups, next: groups[groups.length - 1].items.at(-1).id };
  }
  return { groups: all, next: all[0]?.items.at(-1)?.id ?? null };
}
