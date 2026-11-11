"use client";
// Заказы этого устройства (localStorage). Черновик для чек-поинта: ночью — база и сервер.
import { useEffect } from "react";
import { notify, readKey, writeKey } from "./store";

export const STATUSES = [
  { id: "accepted", label: "Принят" },
  { id: "moderation", label: "Модерация" },
  { id: "production", label: "Производство" },
  { id: "shipped", label: "Передан в доставку" },
  { id: "done", label: "Завершён" },
];

export const DEMO_STEP_MS = 10000;

export function statusLabel(id) {
  return STATUSES.find((s) => s.id === id)?.label || id;
}

export function getOrders() {
  return readKey("orders", []);
}

export function saveOrders(list) {
  writeKey("orders", list);
}

// Создание заказа. Ключ checkoutKey защищает от двойного заказа:
// если заказ с таким ключом уже есть, возвращаем его, а не создаём новый.
export function createOrder({ checkoutKey, items, delivery, promo, totals }) {
  const orders = getOrders();
  const existing = orders.find((o) => o.checkoutKey === checkoutKey);
  if (existing) return { order: existing, created: false };
  const now = Date.now();
  const d = new Date(now);
  const number =
    "PP-" +
    String(d.getFullYear()).slice(2) +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0") +
    "-" +
    String(Math.floor(1000 + Math.random() * 9000));
  const order = {
    id: number,
    checkoutKey,
    createdAt: now,
    status: "accepted",
    statusChangedAt: now,
    history: [{ status: "accepted", at: now }],
    demo: true,
    items,
    delivery,
    promo,
    totals,
  };
  saveOrders([order, ...orders]);
  return { order, created: true };
}

export function setOrderStatus(id, status, by = "демо") {
  const orders = getOrders();
  const o = orders.find((x) => x.id === id);
  if (!o || o.status === status) return;
  const now = Date.now();
  o.status = status;
  o.statusChangedAt = now;
  o.history = [...(o.history || []), { status, at: now, by }];
  saveOrders(orders);
  notify(`Заказ ${o.id}: ${statusLabel(status)}`, status === "done" ? "success" : "info");
}

export function setOrderDemo(id, demo) {
  const orders = getOrders();
  const o = orders.find((x) => x.id === id);
  if (!o) return;
  o.demo = demo;
  o.statusChangedAt = Date.now();
  saveOrders(orders);
}

// Демо-режим: каждые ~10 секунд статус заказа сам переходит на следующий шаг.
export function useDemoTicker() {
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      for (const o of getOrders()) {
        if (!o.demo || o.status === "done") continue;
        if (now - o.statusChangedAt < DEMO_STEP_MS) continue;
        const i = STATUSES.findIndex((s) => s.id === o.status);
        const next = STATUSES[i + 1];
        if (next) setOrderStatus(o.id, next.id);
      }
    };
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
}
