// ESLint (flat config) по документации Next.js 16: правила Next.js + Core Web Vitals.
// Запуск: npm run lint (0 ошибок — обязательная проверка каждого этапа).
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // Временно предупреждения, а не ошибки: старые экраны на localStorage (корзина, заказ)
    // загружают данные в useEffect. S02c–d переводят их на серверный API — там правила вернуть в "error".
    // lib/draft.js и lib/useCatalog.js уже без этого (S02a–b): правила для них — "error".
    files: ["app/cart/**", "app/orders/**", "lib/store.js"],
    rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/purity": "warn" },
  },
  {
    // Скрипты и тесты на Node.js: консоль — их способ отчёта
    files: ["scripts/**", "tests/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", ".night-logs/**", "node_modules/**"]),
]);
