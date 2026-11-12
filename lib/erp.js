// Мок ERP: события производства и их порядок. Общий файл для сервера, экранов и unit-тестов.
// Правила переходов живут в базе (public.erp_apply_event, миграция 0007) — здесь их зеркало для экрана и проверки ввода.

// События, которые присылает ERP (POST /api/v1/erp/events), в порядке производства
export const ERP_EVENTS = ["moderation_passed", "print_started", "printed", "bound", "packed", "handed_to_delivery", "delivered"];

export const EVENT_LABELS = {
  moderation_started: "Оплата получена — проверка макета",
  moderation_passed: "Макет одобрен",
  print_started: "Печать началась",
  printed: "Напечатано",
  bound: "Переплёт и сборка",
  packed: "Упаковано",
  handed_to_delivery: "Передан в доставку",
  delivered: "Доставлен",
  manual_status: "Ручная смена статуса",
};

// Из какого статуса допустимо событие и в какой статус переводит
export const EVENT_RULES = {
  moderation_passed: { from: "moderation", to: "production" },
  print_started: { from: "production", to: "production" },
  printed: { from: "production", to: "production" },
  bound: { from: "production", to: "production" },
  packed: { from: "production", to: "production" },
  handed_to_delivery: { from: "production", to: "shipped" },
  delivered: { from: "shipped", to: "done" },
};

// Подэтапы «Производства» для ленты клиента
export const PRODUCTION_STEPS = [
  { stage: "moderation_passed", label: "Макет одобрен" },
  { stage: "print_started", label: "Печать" },
  { stage: "printed", label: "Напечатано" },
  { stage: "bound", label: "Переплёт и сборка", bookOnly: true },
  { stage: "packed", label: "Упаковано" },
];

export const erpRank = (stage) => (stage ? ERP_EVENTS.indexOf(stage) + 1 : 0);

// Допустимо ли событие для заказа в статусе status со стадией stage (без учёта модерации)
export function eventAllowed(type, status, stage) {
  const rule = EVENT_RULES[type];
  if (!rule || rule.from !== status) return false;
  return type === "moderation_passed" || erpRank(type) > erpRank(stage);
}

const BASE = { accepted: 5, moderation: 15, production: 30, shipped: 95, done: 100 };
const STAGE = { moderation_passed: 30, print_started: 45, printed: 60, bound: 75, packed: 85, handed_to_delivery: 95, delivered: 100 };

// Готовность заказа в процентах для полоски на экране
export function progressFor(status, stage) {
  if (status === "production" && stage && STAGE[stage]) return STAGE[stage];
  return BASE[status] ?? 0;
}
