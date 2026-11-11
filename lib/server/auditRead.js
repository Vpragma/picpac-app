import "server-only";
// Чтение журнала для админки. Запрос идёт от имени админа: правило RLS
// в базе ещё раз проверяет, что у него есть роль admin.

export async function loadAudit(supabase, limit = 100) {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, at, user_id, role, action, object_type, object_id, result, details, ip")
    .order("at", { ascending: false })
    .limit(limit);
  if (error) throw new Error("Не удалось прочитать журнал: " + error.message);

  // Имена пользователей берём из профилей; у удалённых аккаунтов профиля уже нет
  const ids = [...new Set(data.map((r) => r.user_id).filter(Boolean))];
  let names = {};
  if (ids.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", ids);
    names = Object.fromEntries((profiles || []).map((p) => [p.id, p.full_name]));
  }
  return data.map((r) => ({ ...r, user_name: r.user_id ? (names[r.user_id] ?? null) : null }));
}
