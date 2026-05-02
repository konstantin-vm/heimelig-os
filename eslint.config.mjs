import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    ".next/**",
    "node_modules/**",
    "public/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Edge Functions run on Deno — not part of the Node/Next.js bundle.
    // They have their own typecheck during `supabase functions deploy`.
    "supabase/functions/**",
  ]),
]);

export default eslintConfig;
