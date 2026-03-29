import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { HarnessConfig } from "../types.js";

// Resolve paths relative to the harnex package root, not cwd
// In dev: src/config/ → PACKAGE_ROOT is ../..
// In build: dist/bin/ → PACKAGE_ROOT is ../..
const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..", "..");

export const DEFAULT_CONFIG: HarnessConfig = {
	max_iterations: 15,
	passing_threshold: 7.5,
	generator: {
		max_turns: 50,
		allowed_tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
	},
	evaluator: {
		allowed_tools: ["Read", "Bash", "Glob", "Grep"],
		criteria_file: join(PACKAGE_ROOT, "templates", "criteria", "default.yaml"),
	},
	planner: {
		allowed_tools: ["Read", "Write", "Glob", "Grep"],
	},
	prompts: {
		planner: join(PACKAGE_ROOT, "prompts", "planner.md"),
		generator: join(PACKAGE_ROOT, "prompts", "generator.md"),
		evaluator: join(PACKAGE_ROOT, "prompts", "evaluator.md"),
	},
};

export function loadConfig(configPath?: string): HarnessConfig {
	if (!configPath) {
		return structuredClone(DEFAULT_CONFIG);
	}
	const raw = readFileSync(configPath, "utf-8");
	const userConfig = parseYaml(raw);
	if (typeof userConfig !== "object" || userConfig === null) {
		throw new Error(`Invalid config file: ${configPath}`);
	}
	return deepMerge(
		structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>,
		userConfig as Record<string, unknown>,
	) as unknown as HarnessConfig;
}

function deepMerge(
	target: Record<string, unknown>,
	source: Record<string, unknown>,
): Record<string, unknown> {
	for (const key of Object.keys(source)) {
		const sourceVal = source[key];
		const targetVal = target[key];
		if (
			typeof sourceVal === "object" &&
			sourceVal !== null &&
			!Array.isArray(sourceVal) &&
			typeof targetVal === "object" &&
			targetVal !== null &&
			!Array.isArray(targetVal)
		) {
			target[key] = deepMerge(
				targetVal as Record<string, unknown>,
				sourceVal as Record<string, unknown>,
			);
		} else {
			target[key] = sourceVal;
		}
	}
	return target;
}
