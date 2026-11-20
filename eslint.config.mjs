// Obsidian 官方的 ESLint 規則：跟社群目錄自動審查用的是同一套。npm run lint
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores(["node_modules", "main.js", "preview/dist", "test/dist", "esbuild.config.mjs", "version-bump.mjs", "preview/fetch-photos.mjs", "test"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
	},
]);
