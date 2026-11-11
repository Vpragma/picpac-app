"use client";
// Запросы экранов к нашему API. Ответ всегда { ok, ... } или { ok: false, error: { message } }.

export async function callApi(path, { method = "POST", body } = {}) {
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => null);
    if (data && typeof data === "object") return { status: res.status, ...data };
    return { status: res.status, ok: false, error: { message: "Сервер ответил непонятно. Попробуйте ещё раз." } };
  } catch {
    return { status: 0, ok: false, error: { message: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз." } };
  }
}

// Полная перезагрузка страницы после входа или выхода — чтобы все экраны увидели новую сессию
export function goTo(url) {
  window.location.assign(url || "/");
}
