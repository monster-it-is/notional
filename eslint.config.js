import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
    {
        ignores: [
            "**/node_modules/**",
            "**/dist/**",
            "**/coverage/**",
            "**/.vite/**",
            "**/playwright-report/**",
            "**/test-results/**",
        ],
    },

    js.configs.recommended,
    ...tseslint.configs.recommended,

    {
        files: ["apps/api/**/*.ts", "packages/**/*.ts"],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },

    {
        files: ["apps/web/**/*.{ts,tsx}"],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
        },
    },
];