import { describe, expect, it } from "vitest";
import { HarnessEmitter } from "../../src/events/emitter.js";
import { TextRenderer } from "../../src/events/text-renderer.js";

describe("TextRenderer", () => {
	function setup(verbosity: 0 | 1 = 0) {
		const emitter = new HarnessEmitter();
		const output: string[] = [];
		const renderer = new TextRenderer(emitter, verbosity, (line) => output.push(line));
		return { emitter, output, renderer };
	}

	it("renders harness:start with [HARNESS] prefix", () => {
		const { emitter, output } = setup();
		emitter.emit({ type: "harness:start", task: "test task" });
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[HARNESS]");
		expect(output[0]).toContain("test task");
	});

	it("renders agent:start without context for planner", () => {
		const { emitter, output } = setup();
		emitter.emit({ type: "agent:start", agent: "planner" });
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[PLAN]");
		expect(output[0]).toContain("Starting...");
	});

	it("renders agent:start with iteration and feature context", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "agent:start",
			agent: "generator",
			iteration: 2,
			featuresCompleted: 3,
			featuresTotal: 7,
		});
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[GEN]");
		expect(output[0]).toContain("iter 2");
		expect(output[0]).toContain("3/7 features");
	});

	it("renders agent:exit with duration at verbosity 0", () => {
		const { emitter, output } = setup(0);
		emitter.emit({ type: "agent:exit", agent: "planner", exitCode: 0, durationMs: 42000 });
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[PLAN]");
		expect(output[0]).toContain("Done");
		expect(output[0]).toContain("42s");
	});

	it("renders agent:exit with failure and duration", () => {
		const { emitter, output } = setup();
		emitter.emit({ type: "agent:exit", agent: "generator", exitCode: 1, durationMs: 192000 });
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[GEN]");
		expect(output[0]).toContain("Failed");
		expect(output[0]).toContain("exit 1");
		expect(output[0]).toContain("3m 12s");
	});

	it("renders agent:output only at verbosity 1", () => {
		const { emitter, output } = setup(0);
		emitter.emit({ type: "agent:output", agent: "generator", line: "writing file" });
		expect(output).toHaveLength(0);

		const s2 = setup(1);
		s2.emitter.emit({ type: "agent:output", agent: "generator", line: "writing file" });
		expect(s2.output).toHaveLength(1);
		expect(s2.output[0]).toContain("[GEN]");
	});

	it("renders eval:score with score value", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "eval:score",
			iteration: 1,
			scores: { functionality: 8.5, code_quality: 7.2 },
			avg: 7.85,
			passed: false,
		});
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[EVAL]");
		expect(output[0]).toContain("7.85");
	});

	it("formats duration in hours for long runs", () => {
		const { emitter, output } = setup();
		emitter.emit({ type: "agent:exit", agent: "evaluator", exitCode: 0, durationMs: 3723000 });
		expect(output[0]).toContain("1h 2m");
	});

	it("renders Read tool_call immediately", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "agent:tool_call",
			agent: "planner",
			tool: "Read",
			input: { file_path: "package.json" },
		});
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("[PLAN]");
		expect(output[0]).toContain("▸");
		expect(output[0]).toContain("Read");
		expect(output[0]).toContain("package.json");
	});

	it("buffers Write tool_call and renders with result", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "agent:tool_call",
			agent: "generator",
			tool: "Write",
			input: { file_path: "src/index.ts" },
		});
		expect(output).toHaveLength(0);

		emitter.emit({
			type: "agent:tool_result",
			agent: "generator",
			tool: "Write",
			result: "line1\nline2\nline3",
		});
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("Write");
		expect(output[0]).toContain("src/index.ts");
		expect(output[0]).toContain("3 lines");
	});

	it("buffers Bash tool_call and shows last line of result", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "agent:tool_call",
			agent: "generator",
			tool: "Bash",
			input: { command: "pnpm test" },
		});
		expect(output).toHaveLength(0);

		emitter.emit({
			type: "agent:tool_result",
			agent: "generator",
			tool: "Bash",
			result: "running tests...\n\nTests: 12 passed (12)\n",
		});
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("Bash");
		expect(output[0]).toContain("pnpm test");
		expect(output[0]).toContain("Tests: 12 passed (12)");
	});

	it("renders Glob with file count", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "agent:tool_call",
			agent: "planner",
			tool: "Glob",
			input: { pattern: "**/*.ts" },
		});
		emitter.emit({
			type: "agent:tool_result",
			agent: "planner",
			tool: "Glob",
			result: "src/a.ts\nsrc/b.ts\nsrc/c.ts",
		});
		expect(output).toHaveLength(1);
		expect(output[0]).toContain("3 files");
	});

	it("flushes pending tool on agent:exit", () => {
		const { emitter, output } = setup();
		emitter.emit({
			type: "agent:tool_call",
			agent: "generator",
			tool: "Bash",
			input: { command: "echo hello" },
		});
		expect(output).toHaveLength(0);

		emitter.emit({ type: "agent:exit", agent: "generator", exitCode: 0, durationMs: 5000 });
		expect(output).toHaveLength(2);
		expect(output[0]).toContain("Bash");
		expect(output[1]).toContain("Done");
	});
});
