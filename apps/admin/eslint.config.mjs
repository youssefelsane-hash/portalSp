import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // قواعد الـPromise المعتمدة على الأنواع (docs/08 §133) — `eslint-config-next` مابيفعّلش
  // أي قاعدة type-aware، يعني Promise مهملة في handler أو effect كانت بتعدّي بلا أي إنذار.
  // نفس الفئة اللي طلّعت ٥ حالات حقيقية في `apps/api` (منها سباق `client.join()` مع Redis).
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        // `onClick={async () => …}` نمط React عادي ومقبول — React بيتعامل معاه. الخطر
        // الحقيقي هو Promise بتضيع بلا أي معالجة، وده اللي القاعدة اللي فوق بتمسكه.
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
