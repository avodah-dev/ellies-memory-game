import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
	globalIgnores([
		"dist",
		"coverage",
		"playwright-report",
		"test-results",
		"src/routeTree.gen.ts",
	]),
	{
		files: ["**/*.{ts,tsx}"],
		extends: [
			js.configs.recommended,
			tseslint.configs.recommended,
			reactHooks.configs["recommended-latest"],
			reactRefresh.configs.vite,
		],
		rules: {
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
		},
		languageOptions: {
			ecmaVersion: 2020,
			globals: { ...globals.browser, ...globals.node },
		},
	},
	{
		files: ["src/test/**/*", "src/**/*.test.*"],
		rules: { "react-refresh/only-export-components": "off" },
	},
]);
