import "server-only";
// Переменные окружения сервера. Ни одна не начинается с NEXT_PUBLIC_,
// поэтому Next.js не вставляет их в код, который уходит в браузер.

function need(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Не задана переменная окружения ${names[0]}`);
}

export const supabaseUrl = () => need("SUPABASE_URL");
// Публичный ключ: с ним запросы идут от имени пользователя и подчиняются правилам RLS
export const supabasePublicKey = () => need("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY");
// Секретный ключ: полный доступ к базе. Только на сервере.
export const supabaseSecretKey = () => need("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY");

// Двухфакторный вход для модератора и админа. Выключен, если флаг не задан.
export function staffMfaRequired() {
  return /^(1|true|yes|on)$/i.test(process.env.REQUIRE_STAFF_MFA || "");
}

// Cookies только по HTTPS на Vercel; локально (http://localhost) — без флага Secure
export function secureCookies() {
  return process.env.VERCEL === "1";
}
