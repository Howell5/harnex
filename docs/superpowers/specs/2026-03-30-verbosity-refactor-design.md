# Verbosity Refactor - Design Spec

> Redesign verbosity levels so the default experience shows the multi-agent flow
> Date: 2026-03-30

## 1. Problem

The default `harnex run` experience (verbosity 0) is a black box — user sees start, silence, then a score. The tool's value is multi-agent orchestration visibility, but the default hides it. Additionally, `-v` and `-vv` are functionally identical (no `>= 2` checks exist in code).

## 2. Design

### 2.1 Two Verbosity Levels

| Level | CLI flag | Value | Meaning |
|-------|----------|-------|---------|
| normal | (default) | `0` | Flow visible — one or two lines per phase, showing who is doing what and how it went |
| verbose | `-v` | `1` | Full output — adds agent line-by-line stdout, for debugging |

- `Verbosity` type changes from `0 | 1 | 2` to `0 | 1`
- `-vv` is removed; only `-v` remains
- Help text updated accordingly

### 2.2 What Each Level Shows

**Normal (default):**

| Event | Example output |
|-------|---------------|
| `harness:start` | `[HARNESS] Task started: build a todo app` |
| `agent:start` | `[PLAN] Starting...` / `[GEN] Starting (iter 2, 3/7 features)` |
| `agent:exit` | `[PLAN] Done (42s)` / `[GEN] Failed (exit 1, 3m 12s)` |
| `agent:reset` | `[GEN] ⚠ Context reset #2` |
| `eval:score` | `[EVAL] functionality 8.5 / code_quality 7.2 → avg 7.85 ✓` |
| `feature:complete` | `[GEN] feat-003: Add auth middleware ✓ commit a1b2c3` |
| `harness:done` | `[HARNESS] ✓ Done, 2 iteration(s), 1 reset(s), final score 8.2` |
| `error` | `[ERROR] Planner failed (exit 1)` |

**Verbose (`-v`) additionally shows:**

| Event | Example output |
|-------|---------------|
| `agent:output` | `[GEN] Reading spec.md...` (agent's line-by-line stdout) |

### 2.3 Event Type Changes

**`agent:start` — add context fields:**

```typescript
{
  type: "agent:start";
  agent: AgentRole;
  iteration?: number;        // current iteration (planner has none)
  featuresCompleted?: number; // completed feature count
  featuresTotal?: number;     // total feature count
}
```

**`agent:exit` — add duration field:**

```typescript
{
  type: "agent:exit";
  agent: AgentRole;
  exitCode: number;
  durationMs: number;  // process lifetime in milliseconds
}
```

Other event types unchanged.

### 2.4 Emit Responsibility Change

`agent:start` moves from ProcessManager to loop.ts:
- ProcessManager doesn't know iteration/feature progress
- loop.ts emits `agent:start` with context **before** calling `processManager.spawn()`
- ProcessManager continues to emit `agent:output`, `agent:exit`, `error`

ProcessManager records `Date.now()` at spawn, computes delta at close for `durationMs`.

### 2.5 Duration Formatting

- `< 60s` → `42s`
- `>= 60s` → `3m 12s`
- `>= 3600s` → `1h 2m`

### 2.6 TextRenderer Changes

- `agent:start`: render context fields when present (e.g., `Starting (iter 2, 3/7 features)`)
- `agent:exit`: always show in normal mode; format duration as `42s` or `3m 12s`; show exit code only if non-zero
- `agent:output`: show only at verbosity `>= 1` (unchanged gate, but now means `-v` only)
- Remove the `agent:exit` verbosity gate (was `>= 1`, now always shown)

## 3. Files to Change

| File | Change |
|------|--------|
| `src/types.ts` | `Verbosity` → `0 \| 1`; add fields to `agent:start` and `agent:exit` event types |
| `src/orchestrator/process-manager.ts` | Record start time, compute `durationMs` on exit; remove `agent:start` emit |
| `src/orchestrator/loop.ts` | Emit `agent:start` with iteration/feature context before each `processManager.spawn()` call |
| `src/events/text-renderer.ts` | Rewrite `agent:start` and `agent:exit` rendering; adjust verbosity gates |
| `bin/harnex.ts` | Remove `-vv`; simplify `getVerbosity`; update help text |
| `tests/events/text-renderer.test.ts` | Update existing tests; add: contextual agent:start, timed agent:exit, verbosity boundaries |
