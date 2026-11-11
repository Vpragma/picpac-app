import "server-only";
// Подключение к Supabase от имени вошедшего пользователя (сессия — в cookies запроса).
// Создаётся заново на каждый запрос.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { secureCookies, supabasePublicKey, supabaseUrl } from "./env";

export { createSupabaseAdmin, createSupabaseStateless } from "./supabaseAdmin";

// Сессия хранится в cookies, недоступных JavaScript страницы (httpOnly)
export function authCookieOptions() {
  return { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/" };
}

// От имени вошедшего пользователя: база проверяет правила RLS
export async function createSupabaseServer() {
  const store = await cookies();
  return createServerClient(supabaseUrl(), supabasePublicKey(), {
    cookieOptions: authCookieOptions(),
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Страница (Server Component) не может менять cookies — сессию обновляет proxy.js
        }
      },
    },
  });
}
