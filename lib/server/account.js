import "server-only";
// Данные аккаунта: выгрузка, удаление фото, очистка перед удалением аккаунта (МП-06, SEC-17).
import { BUCKET } from "./api";
import { listUserFiles, removeFiles } from "./projects";

// Всё моё одним JSON (читаем сервером строго по user_id)
export async function exportUserData(admin, userId) {
  const pick = async (table, column = "user_id", select = "*") => {
    const { data, error } = await admin.from(table).select(select).eq(column, userId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  };
  const [profile, roles, addresses, projects, photos, cart, orders, interactions, notifications, settings, pushes, requests] = await Promise.all([
    pick("profiles", "id"),
    pick("user_roles", "user_id", "role, created_at"),
    pick("addresses"),
    pick("projects"),
    pick("project_photos", "user_id", "id, project_id, mime, bytes, width, height, position, edits, quality, created_at"),
    pick("cart_items"),
    pick("orders", "user_id", "id, number, status, recipient, delivery_code, delivery_address, currency, goods_kop, discount_kop, delivery_kop, total_kop, promo_code, payment_method, payment_status, paid_at, eta_from, eta_to, created_at"),
    pick("interactions"),
    pick("notifications"),
    pick("notification_settings"),
    pick("push_subscriptions", "user_id", "id, endpoint, user_agent, created_at"),
    pick("data_requests"),
  ]);
  const orderIds = orders.map((o) => o.id);
  const itIds = interactions.map((i) => i.id);
  const [items, history, messages, audit] = await Promise.all([
    orderIds.length ? admin.from("order_items").select("*").in("order_id", orderIds) : { data: [] },
    orderIds.length ? admin.from("order_status_history").select("order_id, status, substatus, at, source, reason").in("order_id", orderIds) : { data: [] },
    itIds.length ? admin.from("interaction_messages").select("interaction_id, author_kind, body, created_at").in("interaction_id", itIds) : { data: [] },
    admin.from("audit_log").select("at, action, object_type, object_id, result").eq("user_id", userId).order("at", { ascending: false }).limit(500),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    timezone: "Europe/Minsk",
    currency: "BYN (суммы в копейках: *_kop)",
    profile: profile[0] || null,
    roles,
    addresses,
    projects,
    photos,
    cart,
    orders: orders.map((o) => ({
      ...o,
      items: (items.data || []).filter((i) => i.order_id === o.id),
      history: (history.data || []).filter((h) => h.order_id === o.id),
    })),
    interactions: interactions.map((i) => ({ ...i, messages: (messages.data || []).filter((m) => m.interaction_id === i.id) })),
    notifications,
    notificationSettings: settings[0] || null,
    pushSubscriptions: pushes,
    dataRequests: requests,
    auditLog: audit.data || [],
  };
}

// Удалить мои фото. Фото заказов, которые ещё в работе, сразу удалить нельзя (они нужны для печати):
// для них создаётся запрос на удаление — фото удалим после завершения заказа.
export async function deleteUserPhotos(admin, userId) {
  const { data: photos, error } = await admin.from("project_photos").select("id, storage_path, project_id, projects!inner(status)").eq("user_id", userId);
  if (error) throw new Error(error.message);
  let activeProjects = new Set();
  const ordered = [...new Set((photos || []).filter((p) => p.projects.status === "ordered").map((p) => p.project_id))];
  if (ordered.length) {
    const { data: items } = await admin.from("order_items").select("project_id, orders!inner(status, user_id)").in("project_id", ordered).eq("orders.user_id", userId);
    activeProjects = new Set((items || []).filter((i) => i.orders.status !== "done").map((i) => i.project_id));
  }
  const keep = (photos || []).filter((p) => activeProjects.has(p.project_id));
  const drop = (photos || []).filter((p) => !activeProjects.has(p.project_id));
  await removeFiles(admin, drop.map((p) => p.storage_path));
  if (drop.length) {
    const ids = drop.map((p) => p.id);
    for (let i = 0; i < ids.length; i += 200) {
      const { error: e2 } = await admin.from("project_photos").delete().in("id", ids.slice(i, i + 200)).eq("user_id", userId);
      if (e2) throw new Error(e2.message);
    }
  }
  // Незафиксированные загрузки (файл есть, строки нет) — тоже удаляем
  const known = new Set((photos || []).map((p) => p.storage_path));
  const orphans = (await listUserFiles(admin, userId)).filter((path) => !known.has(path));
  await removeFiles(admin, orphans);

  let request = null;
  if (keep.length) {
    const { data } = await admin
      .from("data_requests")
      .insert({ user_id: userId, kind: "delete_photos", details: { photos: keep.length, projects: [...activeProjects] } })
      .select("id, kind, status, created_at")
      .single();
    request = data;
  }
  return { deleted: drop.length + orphans.length, kept: keep.length, request };
}

// Перед удалением аккаунта: файлы из хранилища, обезличивание заказов.
// Проекты, корзина, адреса, уведомления, подписки на пуши удалятся каскадом вместе с пользователем (ON DELETE CASCADE).
export async function purgeBeforeAccountDelete(admin, userId) {
  const files = await listUserFiles(admin, userId);
  await removeFiles(admin, files);
  const { error } = await admin
    .from("orders")
    .update({ recipient: {}, delivery_address: {}, anonymized_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return { files: files.length, bucket: BUCKET };
}
