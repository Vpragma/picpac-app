// Роли и правила доступа к разделам. Без секретов: файл используют и сервер, и экраны.

export const ROLES = ["client", "moderator", "admin"];
export const STAFF_ROLES = ["moderator", "admin"];

export const ROLE_LABELS = {
  client: "Клиент",
  moderator: "Модератор",
  admin: "Администратор",
};

export function isRole(value) {
  return ROLES.includes(value);
}

export function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

// Роли всегда в одном порядке: клиент, модератор, админ
export function sortRoles(list) {
  return ROLES.filter((r) => list.includes(r));
}

// Какие роли нужны для адреса. null — раздел открыт всем, в том числе гостям.
export function requiredRolesForPath(pathname) {
  let p = String(pathname || "/");
  try {
    p = decodeURIComponent(p);
  } catch {}
  p = p.toLowerCase();
  if (/^\/(api\/v1\/)?admin\/audit(\/|$)/.test(p)) return ["admin"];
  if (/^\/(api\/v1\/)?admin(\/|$)/.test(p)) return ["moderator", "admin"];
  return null;
}

// Куда вести после входа, если адрес не задан
export function homeForRole(role) {
  return isStaffRole(role) ? "/admin" : "/profile";
}
