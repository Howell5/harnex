import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCriteria } from "../evaluator/criteria-loader.js";
import { calculateWeightedScore } from "../evaluator/scoring.js";
import { getCompletedCount, isAllComplete, loadFeatureList } from "../state/feature-list.js";
import { writeProgressFile } from "../state/progress.js";
import { StateStore } from "../state/state-store.js";
import type { HarnessConfig, HarnessEvent } from "../types.js";
import type { ProcessManager } from "./process-manager.js";
import { generateTaskSlug } from "./slug.js";

interface LoopOptions {
	config: HarnessConfig;
	projectDir: string;
	spec: string;
	specFile?: string;
	emitter: { emit(event: HarnessEvent): void };
	processManager: ProcessManager;
}

interface LoopResult {
	success: boolean;
	iterations: number;
	resets: number;
	finalScore: number;
}

export async function runHarnessLoop(options: LoopOptions): Promise<LoopResult> {
	const { config, projectDir, spec, specFile, emitter, processManager } = options;

	emitter.emit({ type: "harness:start", task: spec });

	// Generate task directory with AI slug
	const slug = await generateTaskSlug(spec);
	let taskDir = join(projectDir, ".harnex", "tasks", slug);
	let suffix = 2;
	while (existsSync(taskDir)) {
		taskDir = join(projectDir, ".harnex", "tasks", `${slug}-${suffix}`);
		suffix++;
	}
	mkdirSync(taskDir, { recursive: true });

	const stateStore = new StateStore(taskDir);
	const featureListPath = join(taskDir, "feature-list.json");
	const progressPath = join(taskDir, "progress.txt");

	stateStore.initialize(spec, config.max_iterations);

	// Phase 1: Planning
	emitter.emit({ type: "agent:start", agent: "planner" });
	const plannerPrompt = specFile
		? `Read the task from: ${specFile}\n\nWrite your outputs to the task directory:\n- Create ${taskDir}/spec.md\n- Create ${taskDir}/feature-list.json`
		: `Task: ${spec}\n\nWrite your outputs to the task directory:\n- Create ${taskDir}/spec.md\n- Create ${taskDir}/feature-list.json\n\nRead the existing codebase first.`;

	const plannerResult = await processManager.spawn({
		role: "planner",
		systemPrompt: config.prompts.planner,
		allowedTools: config.planner.allowed_tools,
		inputPrompt: plannerPrompt,
		workingDir: projectDir,
	});

	if (plannerResult.exitCode !== 0) {
		emitter.emit({ type: "error", message: `Planner failed (exit ${plannerResult.exitCode})` });
		return { success: false, iterations: 0, resets: 0, finalScore: 0 };
	}

	if (!existsSync(join(taskDir, "spec.md")) || !existsSync(featureListPath)) {
		emitter.emit({
			type: "error",
			message: "Planner did not produce spec.md and/or feature-list.json",
		});
		return { success: false, iterations: 0, resets: 0, finalScore: 0 };
	}

	const initialFeatures = loadFeatureList(featureListPath);
	stateStore.updatePhase("generation");
	stateStore.updateProgress(initialFeatures.length, 0);

	// Phase 2: Generate + Evaluate loop
	let iteration = 0;
	let resetCount = 0;
	let finalScore = 0;

	while (iteration < config.max_iterations) {
		stateStore.incrementIteration();
		iteration++;

		// Generator loop (may restart multiple times within one iteration)
		let allDone = false;
		let stuckCount = 0;

		while (!allDone) {
			const beforeFeatures = loadFeatureList(featureListPath);
			const beforeCompleted = getCompletedCount(beforeFeatures);

			emitter.emit({
				type: "agent:start",
				agent: "generator",
				iteration,
				featuresCompleted: beforeCompleted,
				featuresTotal: beforeFeatures.length,
			});

			await processManager.spawn({
				role: "generator",
				systemPrompt: config.prompts.generator,
				allowedTools: config.generator.allowed_tools,
				maxTurns: config.generator.max_turns,
				inputPrompt: buildGeneratorPrompt(projectDir, taskDir),
				workingDir: projectDir,
			});

			const afterFeatures = loadFeatureList(featureListPath);
			const afterCompleted = getCompletedCount(afterFeatures);
			stateStore.updateProgress(afterFeatures.length, afterCompleted);

			if (isAllComplete(afterFeatures)) {
				allDone = true;
			} else if (afterCompleted > beforeCompleted) {
				// Progress made but not done — context reset
				stuckCount = 0;
				resetCount++;
				stateStore.recordReset();
				emitter.emit({ type: "agent:reset", agent: "generator", count: resetCount });
				const latestState = stateStore.load();
				if (latestState) writeProgressFile(progressPath, latestState, afterFeatures);
			} else {
				// No progress
				stuckCount++;
				if (stuckCount >= 2) {
					emitter.emit({
						type: "error",
						message: "Generator stuck — no progress across 2 consecutive runs",
					});
					return { success: false, iterations: iteration, resets: resetCount, finalScore: 0 };
				}
				resetCount++;
				stateStore.recordReset();
				emitter.emit({ type: "agent:reset", agent: "generator", count: resetCount });
			}
		}

		// Evaluation
		stateStore.updatePhase("evaluation");
		const criteriaPath = config.evaluator.criteria_file || join(projectDir, "criteria.yaml");

		if (!existsSync(criteriaPath)) {
			emitter.emit({ type: "error", message: `Criteria file not found: ${criteriaPath}` });
			return { success: false, iterations: iteration, resets: resetCount, finalScore: 0 };
		}

		const criteria = loadCriteria(criteriaPath);
		const evalFeatures = loadFeatureList(featureListPath);

		emitter.emit({
			type: "agent:start",
			agent: "evaluator",
			iteration,
			featuresCompleted: getCompletedCount(evalFeatures),
			featuresTotal: evalFeatures.length,
		});

		await processManager.spawn({
			role: "evaluator",
			systemPrompt: config.prompts.evaluator,
			allowedTools: config.evaluator.allowed_tools,
			inputPrompt: buildEvaluatorPrompt(projectDir, taskDir, criteriaPath),
			workingDir: projectDir,
		});

		const scoresPath = join(taskDir, "scores.json");
		if (!existsSync(scoresPath)) {
			emitter.emit({ type: "error", message: "Evaluator did not produce scores.json" });
			return { success: false, iterations: iteration, resets: resetCount, finalScore: 0 };
		}

		const scores = JSON.parse(readFileSync(scoresPath, "utf-8"));
		const weightedAvg = calculateWeightedScore(scores, criteria);
		const passed = weightedAvg >= config.passing_threshold;
		finalScore = weightedAvg;

		emitter.emit({ type: "eval:score", iteration, scores, avg: weightedAvg, passed });
		stateStore.addEvaluation({
			iteration,
			scores,
			weighted_avg: weightedAvg,
			passed,
			feedback_file: join(taskDir, `feedback-iter-${iteration}.md`),
		});

		if (passed) {
			stateStore.updatePhase("complete");
			emitter.emit({
				type: "harness:done",
				iterations: iteration,
				resets: resetCount,
				score: finalScore,
			});
			return { success: true, iterations: iteration, resets: resetCount, finalScore };
		}

		stateStore.updatePhase("generation");
	}

	emitter.emit({
		type: "error",
		message: `Max iterations (${config.max_iterations}) reached. Score: ${finalScore}`,
	});
	return { success: false, iterations: iteration, resets: resetCount, finalScore };
}

function buildGeneratorPrompt(projectDir: string, taskDir: string): string {
	return `Read your input files and implement the next pending feature:
1. Read ${taskDir}/spec.md for requirements
2. Read ${taskDir}/feature-list.json to find the next pending feature
3. Read ${taskDir}/progress.txt (if exists) for context from previous work
4. Read ${taskDir}/feedback.md (if exists) and address feedback first
5. Implement the feature, commit, and update state files
Working directory: ${projectDir}`;
}

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
