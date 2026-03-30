# Task Directory Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all per-task state files into `.harnex/tasks/{slug}-{date}/` with AI-generated slug names.

**Architecture:** Add a `generateTaskSlug()` function that makes a lightweight SDK call. Refactor loop.ts to compute a `taskDir` and pass it to all path references. Update prompt builders to inject task directory paths.

**Tech Stack:** TypeScript, @anthropic-ai/claude-agent-sdk, vitest

---

## File Structure

| File | Role | Action |
|------|------|--------|
| `src/orchestrator/slug.ts` | Generate task slug via SDK | Create |
| `src/orchestrator/loop.ts` | Main orchestration loop | Modify — use taskDir for all paths |
| `src/commands/plan.ts` | Plan-only command | Modify — use taskDir |
| `src/commands/eval.ts` | Eval-only command | Modify — use taskDir |
| `src/commands/init.ts` | Init command | Modify — add .gitignore handling |
| `tests/orchestrator/slug.test.ts` | Slug generation tests | Create |
| `tests/commands/init.test.ts` | Init tests | Modify — test .gitignore |

---

### Task 1: Create slug generator

**Files:**
- Create: `src/orchestrator/slug.ts`
- Create: `tests/orchestrator/slug.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/orchestrator/slug.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { generateTaskSlug } from "../../src/orchestrator/slug.js";

const mockQuery = vi.mocked(query);

function createMockStream(messages: Array<Record<string, unknown>>) {
	return {
		async *[Symbol.asyncIterator]() {
			for (const msg of messages) {
				yield msg;
			}
		},
	};
}

describe("generateTaskSlug", () => {
	it("generates slug from SDK response", async () => {
		mockQuery.mockReturnValue(
			createMockStream([
				{ type: "result", subtype: "success", result: "hero-section-redesign" },
			]) as ReturnType<typeof query>,
		);

		const slug = await generateTaskSlug("Redesign the hero section of the landing page");
		expect(slug).toMatch(/^hero-section-redesign-\d{4}-\d{2}-\d{2}$/);
	});

	it("cleans whitespace and newlines from response", async () => {
		mockQuery.mockReturnValue(
			createMockStream([
				{ type: "result", subtype: "success", result: "  auth-middleware\n" },
			]) as ReturnType<typeof query>,
		);

		const slug = await generateTaskSlug("Add auth middleware");
		expect(slug).toMatch(/^auth-middleware-\d{4}-\d{2}-\d{2}$/);
	});

	it("falls back on SDK error", async () => {
		mockQuery.mockReturnValue(
			// biome-ignore lint/correctness/useYield: intentionally throwing before yield
			(async function* () {
				throw new Error("Rate limit");
			})() as ReturnType<typeof query>,
		);

		const slug = await generateTaskSlug("Some task");
		expect(slug).toMatch(/^task-\d{4}-\d{2}-\d{2}-\d{3}$/);
	});

	it("falls back on empty response", async () => {
		mockQuery.mockReturnValue(
			createMockStream([
				{ type: "result", subtype: "success", result: "" },
			]) as ReturnType<typeof query>,
		);

		const slug = await generateTaskSlug("Some task");
		expect(slug).toMatch(/^task-\d{4}-\d{2}-\d{2}-\d{3}$/);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- tests/orchestrator/slug.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/orchestrator/slug.ts`:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

function todayDate(): string {
	return new Date().toISOString().slice(0, 10);
}

function fallbackSlug(): string {
	const rand = String(Math.floor(Math.random() * 1000)).padStart(3, "0");
	return `task-${todayDate()}-${rand}`;
}

export async function generateTaskSlug(spec: string): Promise<string> {
	try {
		const response = query({
			prompt: `Generate a 2-4 word kebab-case identifier for this task. Output ONLY the identifier, nothing else.\n\nTask: ${spec}`,
			options: {
				maxTurns: 1,
				allowedTools: [],
				permissionMode: "bypassPermissions",
			},
		});

		let result = "";
		// biome-ignore lint: SDK message types require runtime checks
		for await (const msg of response as any) {
			if (msg.type === "result" && msg.subtype === "success") {
				result = (msg.result ?? "").trim();
			}
		}

		if (!result || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(result)) {
			return fallbackSlug();
		}

		return `${result}-${todayDate()}`;
	} catch {
		return fallbackSlug();
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- tests/orchestrator/slug.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/slug.ts tests/orchestrator/slug.test.ts
git commit -m "feat: add AI-powered task slug generator

Lightweight SDK call to generate kebab-case task identifiers.
Falls back to task-{date}-{random} on error or invalid response."
```

---

### Task 2: Refactor loop.ts to use task directory

**Files:**
- Modify: `src/orchestrator/loop.ts`

- [ ] **Step 1: Update loop.ts**

Key changes to `src/orchestrator/loop.ts`:

1. Import `generateTaskSlug`:
```typescript
import { generateTaskSlug } from "./slug.js";
```

2. After `emitter.emit({ type: "harness:start", task: spec })`, add slug generation and taskDir computation:
```typescript
emitter.emit({ type: "harness:start", task: spec });

// Generate task directory
const slug = await generateTaskSlug(spec);
let taskDir = join(projectDir, ".harnex", "tasks", slug);
let suffix = 2;
while (existsSync(taskDir)) {
	taskDir = join(projectDir, ".harnex", "tasks", `${slug}-${suffix}`);
	suffix++;
}
mkdirSync(taskDir, { recursive: true });
```

3. Add `mkdirSync` to imports:
```typescript
import { existsSync, mkdirSync, readFileSync } from "node:fs";
```

4. Replace all path references:
```typescript
const stateStore = new StateStore(taskDir);
const featureListPath = join(taskDir, "feature-list.json");
const progressPath = join(taskDir, "progress.txt");
```

5. Update planner prompt:
```typescript
const plannerPrompt = specFile
	? `Read the task from: ${specFile}\n\nWrite your outputs to the task directory:\n- Create ${taskDir}/spec.md\n- Create ${taskDir}/feature-list.json`
	: `Task: ${spec}\n\nWrite your outputs to the task directory:\n- Create ${taskDir}/spec.md\n- Create ${taskDir}/feature-list.json\n\nRead the existing codebase first.`;
```

6. Update spec.md existence check:
```typescript
if (!existsSync(join(taskDir, "spec.md")) || !existsSync(featureListPath)) {
```

7. Update scores.json path:
```typescript
const scoresPath = join(taskDir, "scores.json");
```

8. Update feedback_file path in addEvaluation:
```typescript
feedback_file: join(taskDir, `feedback-iter-${iteration}.md`),
```

9. Update `buildGeneratorPrompt` to accept `taskDir`:
```typescript
function buildGeneratorPrompt(projectDir: string, taskDir: string): string {
	return `Read your input files and implement the next pending feature:
1. Read ${taskDir}/spec.md for requirements
2. Read ${taskDir}/feature-list.json to find the next pending feature
3. Read ${taskDir}/progress.txt (if exists) for context from previous work
4. Read ${taskDir}/feedback.md (if exists) and address feedback first
5. Implement the feature, commit, and update state files
Working directory: ${projectDir}`;
}
```

10. Update `buildEvaluatorPrompt` to accept `taskDir`:
```typescript
function buildEvaluatorPrompt(projectDir: string, taskDir: string, criteriaPath: string): string {
	return `Evaluate the current state of the project:
1. Read the criteria file: ${criteriaPath}
2. Read ${taskDir}/feature-list.json to see what was built
3. Read ${taskDir}/spec.md for full requirements
4. Run verification commands (tsc, linter, tests)
5. Check each dimension's checklist items
6. Write ${taskDir}/scores.json with per-dimension scores
7. Write ${taskDir}/feedback.md with specific, actionable improvements
Working directory: ${projectDir}`;
}
```

11. Update call sites to pass `taskDir`:
```typescript
inputPrompt: buildGeneratorPrompt(projectDir, taskDir),
```
```typescript
inputPrompt: buildEvaluatorPrompt(projectDir, taskDir, criteriaPath),
```

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean (or only test-related errors).

- [ ] **Step 3: Commit**

```bash
git add src/orchestrator/loop.ts
git commit -m "refactor: move all task files into .harnex/tasks/{slug}/

AI-generated slug for directory name. All state files (spec, features,
progress, scores, feedback) now scoped to task directory."
```

---

### Task 3: Update plan and eval standalone commands

**Files:**
- Modify: `src/commands/plan.ts`
- Modify: `src/commands/eval.ts`

- [ ] **Step 1: Read current plan.ts and eval.ts**

Read both files to understand current structure.

- [ ] **Step 2: Update plan.ts**

The standalone `plan` command also creates spec.md and feature-list.json. Update it to use a task directory:

```typescript
import { existsSync, mkdirSync } from "node:fs";
// ... existing imports
import { generateTaskSlug } from "../orchestrator/slug.js";

// Inside planCommand, after loading config:
const slug = await generateTaskSlug(taskSpec);
let taskDir = join(process.cwd(), ".harnex", "tasks", slug);
let suffix = 2;
while (existsSync(taskDir)) {
	taskDir = join(process.cwd(), ".harnex", "tasks", `${slug}-${suffix}`);
	suffix++;
}
mkdirSync(taskDir, { recursive: true });
```

Update the planner prompt to reference `taskDir`.

- [ ] **Step 3: Update eval.ts**

The eval command writes scores.json and feedback.md. These should also go into a task directory. However, eval is usually run after a task already exists. For standalone eval, use a simple `eval-{date}` directory or write to the current directory since there's no task context.

For now, keep eval.ts writing to project root — it's a standalone diagnostic tool. The loop.ts path already handles eval within a run.

- [ ] **Step 4: Run type check and tests**

Run: `npx tsc --noEmit && pnpm test`
Expected: Clean.

- [ ] **Step 5: Commit**

```bash
git add src/commands/plan.ts src/commands/eval.ts
git commit -m "refactor: plan command uses task directory for outputs"
```

---

### Task 4: Update init command to handle .gitignore

**Files:**
- Modify: `src/commands/init.ts`
- Modify: `tests/commands/init.test.ts`

- [ ] **Step 1: Update init.ts**

Add .gitignore handling after the existing file creation logic:

```typescript
// After the existing harnex.yaml and criteria creation...

const gitignorePath = join(cwd, ".gitignore");
const harnexIgnore = ".harnex/";

if (existsSync(gitignorePath)) {
	const content = readFileSync(gitignorePath, "utf-8");
	if (!content.includes(harnexIgnore)) {
		appendFileSync(gitignorePath, `\n${harnexIgnore}\n`);
		console.log("Added .harnex/ to .gitignore");
		created++;
	}
} else {
	writeFileSync(gitignorePath, `${harnexIgnore}\n`);
	console.log("Created .gitignore with .harnex/");
	created++;
}
```

Add `appendFileSync`, `readFileSync`, `writeFileSync` to the fs import.

- [ ] **Step 2: Add test for .gitignore handling**

Append to `tests/commands/init.test.ts`:

```typescript
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
```

Add `writeFileSync` to the fs import in the test file.

- [ ] **Step 3: Run tests**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/commands/init.ts tests/commands/init.test.ts
git commit -m "feat: init command adds .harnex/ to .gitignore"
```

---

### Task 5: Final verification and publish

- [ ] **Step 1: Clean up generated files from project root**

```bash
rm -f spec.md feature-list.json progress.txt scores.json feedback.md
rm -rf .harnex/
```

- [ ] **Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

- [ ] **Step 3: Run linter**

Run: `pnpm lint`
Expected: Clean.

- [ ] **Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: Clean.

- [ ] **Step 5: Build and smoke test**

Run: `pnpm build && bash scripts/smoke-test.sh`
Expected: Pass.

- [ ] **Step 6: Bump version and commit**

Edit `package.json` version to `0.1.9`.

```bash
git add package.json
git commit -m "chore: bump to v0.1.9 for task directory restructure"
```

- [ ] **Step 7: Publish and push**

```bash
pnpm publish --access public
git push
```
