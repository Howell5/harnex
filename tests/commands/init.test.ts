import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("initCommand", () => {
	let tempDir: string;
	const originalCwd = process.cwd;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "harnex-init-"));
		vi.spyOn(process, "cwd").mockReturnValue(tempDir);
	});

	afterEach(() => {
		process.cwd = originalCwd;
		vi.restoreAllMocks();
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("creates harnex.yaml and criteria/default.yaml", async () => {
		const { initCommand } = await import("../../src/commands/init.js");
		initCommand();

		expect(existsSync(join(tempDir, "harnex.yaml"))).toBe(true);
		expect(existsSync(join(tempDir, "criteria", "default.yaml"))).toBe(true);

		const config = readFileSync(join(tempDir, "harnex.yaml"), "utf-8");
		expect(config).toContain("max_iterations");
	});

	it("skips existing files", async () => {
		const { initCommand } = await import("../../src/commands/init.js");
		initCommand();

		const original = readFileSync(join(tempDir, "harnex.yaml"), "utf-8");
		initCommand();

		const after = readFileSync(join(tempDir, "harnex.yaml"), "utf-8");
		expect(after).toBe(original);
	});

	it("adds .harnex/ to existing .gitignore", async () => {
		const { initCommand } = await import("../../src/commands/init.js");
		writeFileSync(join(tempDir, ".gitignore"), "node_modules/\n");
		initCommand();
		const content = readFileSync(join(tempDir, ".gitignore"), "utf-8");
		expect(content).toContain(".harnex/");
		expect(content).toContain("node_modules/");
	});

	it("creates .gitignore if missing", async () => {
		const { initCommand } = await import("../../src/commands/init.js");
		initCommand();
		const content = readFileSync(join(tempDir, ".gitignore"), "utf-8");
		expect(content).toContain(".harnex/");
	});

	it("skips .gitignore if .harnex/ already present", async () => {
		const { initCommand } = await import("../../src/commands/init.js");
		writeFileSync(join(tempDir, ".gitignore"), "node_modules/\n.harnex/\n");
		initCommand();
		const content = readFileSync(join(tempDir, ".gitignore"), "utf-8");
		const count = (content.match(/\.harnex\//g) || []).length;
		expect(count).toBe(1);
	});
});
