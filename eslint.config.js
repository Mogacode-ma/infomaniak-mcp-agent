import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import unicorn from "eslint-plugin-unicorn";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "*.config.js", "*.config.ts"],
  },
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.eslint.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
      unicorn,
    },
    rules: {
      // TypeScript strict
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/explicit-function-return-type": [
        "warn",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/consistent-type-imports": "error",

      // Imports
      "import/order": [
        "error",
        {
          groups: ["builtin", "external", "internal", "parent", "sibling", "index"],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import/no-duplicates": "error",

      // Unicorn (modern best practices)
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-top-level-await": "error",
      "unicorn/no-process-exit": "off",
      "unicorn/prevent-abbreviations": "off",
      "unicorn/no-null": "off",
      "unicorn/filename-case": ["error", { case: "kebabCase" }],

      // Code quality
      "no-console": ["warn", { allow: ["error", "warn"] }],
      "no-debugger": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always"],
      curly: ["error", "all"],
    },
  },
  prettier,
];
