import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Electron and scripts are JavaScript entrypoints, so the TypeScript require rule is relaxed there.
    files: ["electron/**/*.js", "scripts/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Keep linting focused on this repository's generated output directories.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
