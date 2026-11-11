// ESLint (flat config) по документации Next.js 16: правила Next.js + Core Web Vitals.
// Запуск: npm run lint (0 ошибок — обязательная проверка каждого этапа).
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  {
    // Временно предупреждения, а не ошибки: старые экраны на localStorage (корзина, заказ, черновик)
    // загружают данные в useEffect. S02 переводит их на серверный API — там правила вернуть в "error".
    files: ["app/cart/**", "app/orders/**", "lib/draft.js", "lib/store.js", "lib/useCatalog.js"],
    rules: { "react-hooks/set-state-in-effect": "warn", "react-hooks/purity": "warn" },
  },
  {
    // Скрипты и тесты на Node.js: консоль — их способ отчёта
    files: ["scripts/**", "tests/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", ".night-logs/**", "node_modules/**"]),
]);
