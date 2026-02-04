import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import security from "eslint-plugin-security";
import prettier from "eslint-plugin-prettier";

export default [
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      security,
      prettier,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        console: "readonly",
        FormData: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        alert: "readonly",
        Math: "readonly",
        Blob: "readonly",
        URL: "readonly",
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React rules
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Security rules
      "security/detect-object-injection": "warn",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-unsafe-regex": "error",

      // Code quality
      "no-unused-vars": "warn",
      "no-console": "warn",
      "prefer-const": "error",

      // Prettier
      "prettier/prettier": "error",
    },
  },
  {
    ignores: ["dist/", "build/", "node_modules/", "*.config.js", "vite.config.js"],
  },
];
