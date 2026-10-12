import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules",
      "coverage",
      "dist",
      "web/dist",
      "runs",
      ".spike",
      ".impeccable",
      "playwright-report",
      "test-results",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      "no-empty": ["error", { allowEmptyCatch: false }],
      eqeqeq: "error",
    },
  },
  { files: ["web/src/**/*.tsx", "web/src/**/*.ts"], languageOptions: { globals: { ...globals.browser } } },
  { files: ["**/*.js"], ...tseslint.configs.disableTypeChecked },
);
