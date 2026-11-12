// Бот поддержки: первый ответ на обращение по заказу. Чистые функции (unit-тесты), данные — только этого заказа.
// Первая фраза всегда «Обращение по заказу {номер} получено.»
import { progressFor } from "./erp.js";

const LABELS = { accepted: "Принят", moderation: "Модерация", production: "Производство", shipped: "Готов / передан в доставку", done: "Завершён" };

const day = (iso) => new Date(iso).toLocaleDateString("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "long" });

// «17–18 ноября», «30 ноября – 2 декабря», «17 ноября»
export function etaText(from, to) {
  if (!from) return "";
  const a = day(from);
  if (!to || day(to) === a) return a;
  const b = day(to);
  const [da, ma] = a.split(" ");
  const [db, mb] = b.split(" ");
  return ma === mb ? `${da}–${db} ${mb}` : `${a} – ${b}`;
}

export const isWhereTopic = (topic) => /где|статус|когда/i.test(String(topic || ""));

// order: { number, status, substatus, erp_stage, eta_from, eta_to }
export function botReply({ topic, order, slaText }) {
  const head = `Обращение по заказу ${order.number} получено.`;
  if (isWhereTopic(topic)) {
    const label = LABELS[order.status] || order.status;
    const sub = order.substatus && order.substatus !== label ? ` — ${order.substatus}` : "";
    const progress = progressFor(order.status, order.erp_stage);
    const eta = etaText(order.eta_from, order.eta_to);
    const when =
      order.status === "done" ? "Заказ уже доставлен." : order.status === "shipped" ? `Заказ передан в доставку, ориентировочно привезём ${eta}.` : eta ? `Ориентировочная дата доставки: ${eta}.` : "";
    return { body: `${head} Сейчас статус «${label}»${sub}, готовность ${progress} %. ${when} Если остались вопросы — напишите здесь, оператор ответит до ${slaText}.`.replace(/\s+/g, " ").trim(), answered: true };
  }
  if (/перепечат/i.test(String(topic || ""))) {
    const why = /макет/i.test(topic) ? "ошибка в макете" : "брак печати";
    return {
      body: `${head} Заявка на перепечатку, причина: ${why}. Оператор проверит её и ответит до ${slaText}.${why === "брак печати" ? " Сфотографируйте брак — фото пригодится оператору." : ""}`,
      answered: false,
    };
  }
  return { body: `Спасибо! ${head} Оператор ответит до ${slaText}.`, answered: false };
}
