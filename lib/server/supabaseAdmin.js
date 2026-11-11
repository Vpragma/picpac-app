import "server-only";
// Подключения к Supabase без cookies браузера. Можно использовать и в proxy.js.
import { createClient } from "@supabase/supabase-js";
import { supabasePublicKey, supabaseSecretKey, supabaseUrl } from "./env";

const noSession = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

// С секретным ключом: обходит RLS. Только для действий, которые сервер уже проверил.
export function createSupabaseAdmin() {
  return createClient(supabaseUrl(), supabaseSecretKey(), { auth: noSession });
}

// Без сохранения сессии: чтобы проверить пароль, не трогая cookies
export function createSupabaseStateless() {
  return createClient(supabaseUrl(), supabasePublicKey(), { auth: noSession });
}
