# Task Directory Restructure - Design Spec

> Move all per-task state files into `.harnex/tasks/{slug}-{date}/` with AI-generated slug
> Date: 2026-03-30

## 1. Problem

All state files (`spec.md`, `feature-list.json`, `progress.txt`, `scores.json`, `feedback.md`) are written to the project root, polluting the user's codebase. Additionally, running harnex twice overwrites the first run's files — no task isolation.

## 2. Design

### 2.1 Directory Structure

```
.harnex/
└── tasks/
    ├── hero-section-redesign-2026-03-30/
    │   ├── state.yaml
    │   ├── spec.md
    │   ├── feature-list.json
    │   ├── progress.txt
    │   ├── scores.json
    │   └── feedback.md
    └── auth-middleware-2026-03-30/
        ├── state.yaml
        ├── spec.md
        └── ...
```

### 2.2 Slug Generation

Before the planner runs, loop.ts makes a lightweight SDK call (no tools, 1 turn) to generate a task slug:

**Prompt:** `Generate a 2-4 word kebab-case identifier for this task. Output ONLY the identifier, nothing else.\n\nTask: {spec}`

**Example:** `hero-section-redesign`

The slug is combined with today's date: `hero-section-redesign-2026-03-30`.

**Collision handling:** If directory exists, append `-2`, `-3`, etc.

**Fallback:** If slug generation fails (SDK error, empty response, invalid format), fall back to `task-{date}-{random3digits}`.

### 2.3 Task Directory (`taskDir`)

`taskDir = join(projectDir, ".harnex", "tasks", slug)`

All per-task file paths change from `join(projectDir, "file")` to `join(taskDir, "file")`:

| File | Before | After |
|------|--------|-------|
| state.yaml | `.harnex/state.yaml` | `.harnex/tasks/{slug}/state.yaml` |
| spec.md | `./spec.md` | `.harnex/tasks/{slug}/spec.md` |
| feature-list.json | `./feature-list.json` | `.harnex/tasks/{slug}/feature-list.json` |
| progress.txt | `./progress.txt` | `.harnex/tasks/{slug}/progress.txt` |
| scores.json | `./scores.json` | `.harnex/tasks/{slug}/scores.json` |
| feedback.md | `./feedback.md` | `.harnex/tasks/{slug}/feedback.md` |

### 2.4 Prompt Path Injection

Agent prompts (inputPrompt in loop.ts) must reference the task directory paths. System prompts (prompts/*.md) stay unchanged — they describe roles, not paths.

**Planner inputPrompt:**
```
Task: {spec}

Write your outputs to the task directory: {taskDir}/
- Create {taskDir}/spec.md
- Create {taskDir}/feature-list.json

Read the existing codebase first.
```

**Generator inputPrompt:**
```
Read your input files and implement the next pending feature:
1. Read {taskDir}/spec.md for requirements
2. Read {taskDir}/feature-list.json to find the next pending feature
3. Read {taskDir}/progress.txt (if exists) for context from previous work
4. Read {taskDir}/feedback.md (if exists) and address feedback first
5. Implement the feature, commit, and update state files
Working directory: {projectDir}
```

**Evaluator inputPrompt:**
```
Evaluate the current state of the project:
1. Read the criteria file: {criteriaPath}
2. Read {taskDir}/feature-list.json to see what was built
3. Read {taskDir}/spec.md for full requirements
4. Run verification commands (tsc, linter, tests)
5. Check each dimension's checklist items
6. Write {taskDir}/scores.json with per-dimension scores
7. Write {taskDir}/feedback.md with specific, actionable improvements
Working directory: {projectDir}
```

### 2.5 .gitignore

`harnex init` appends `.harnex/` to `.gitignore` if not already present.

### 2.6 StateStore Change

`StateStore` constructor receives `taskDir` instead of `harnessDir`. The `state.yaml` lives inside the task directory.

## 3. Files to Change

| File | Change |
|------|--------|
| `src/orchestrator/loop.ts` | Add slug generation call; compute `taskDir`; update all file paths; update prompt builders |
| `src/state/state-store.ts` | Constructor receives task dir (minor — just the path changes) |
| `src/commands/init.ts` | Append `.harnex/` to `.gitignore` |
| `src/commands/eval.ts` | Update scores.json path to use task dir |
| `src/commands/plan.ts` | Update planner prompt to use task dir |
| `tests/orchestrator/loop.test.ts` | Update paths in tests |
| `tests/commands/init.test.ts` | Test .gitignore append |
