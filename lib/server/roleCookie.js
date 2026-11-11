import "server-only";
// Cookie выбранной роли: "роль.id_пользователя", только httpOnly.
// Сама по себе прав не даёт — сервер в каждом запросе сверяет роль с таблицей user_roles.
import { isRole, isStaffRole } from "../roles";
import { secureCookies } from "./env";

export const ROLE_COOKIE = "pp_role";
const STAFF_ROLE_SECONDS = 12 * 60 * 60; // роль сотрудника — 12 часов, потом выбрать заново
const CLIENT_ROLE_SECONDS = 30 * 24 * 60 * 60;

// Роль из cookie, если cookie правильной формы и выдана этому пользователю. Иначе null.
export function parseRoleCookie(value, userId) {
  if (!value || !userId) return null;
  const dot = value.indexOf(".");
  if (dot < 1) return null;
  const role = value.slice(0, dot);
  return value.slice(dot + 1) === userId && isRole(role) ? role : null;
}

export function roleCookieOptions(role) {
  return {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    maxAge: isStaffRole(role) ? STAFF_ROLE_SECONDS : CLIENT_ROLE_SECONDS,
  };
}

// Какая роль действует сейчас: из cookie (если она есть у пользователя в базе),
// а единственная роль выбирается сама — экран выбора нужен только при нескольких ролях.
export function effectiveRole(claimed, roles) {
  if (claimed && roles.includes(claimed)) return claimed;
  if (roles.length === 1) return roles[0];
  return null;
}
