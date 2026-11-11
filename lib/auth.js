"use client";
// ЧЕРНОВИК ДЛЯ ЧЕК-ПОИНТА: вход без настоящей защиты.
// Пароли тестовые и проверяются в браузере. Ночью заменяем на настоящий вход на сервере.
export const TEST_ACCOUNTS = [
  { email: "client@test", password: "demo", roles: ["client"], name: "Тестовый клиент" },
  { email: "admin@test", password: "demo", roles: ["client", "admin"], name: "Администратор" },
];

export function checkLogin(email, password) {
  const e = String(email).trim().toLowerCase();
  return TEST_ACCOUNTS.find((a) => a.email === e && a.password === password) || null;
}
