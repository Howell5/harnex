import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["bin/harness.ts"],
	format: ["esm"],
	target: "node20",
	outDir: "dist/bin",
	clean: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
});
