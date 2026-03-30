import { readFileSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentConfig, AgentResult, HarnessEvent } from "../types.js";

interface Emitter {
	emit(event: HarnessEvent): void;
}

export class ProcessManager {
	constructor(private emitter: Emitter) {}

	async spawn(config: AgentConfig): Promise<AgentResult> {
		const systemPromptContent = readFileSync(config.systemPrompt, "utf-8");
		const startTime = Date.now();
		let resultText = "";
		let lastToolName = "";

		try {
			const response = query({
				prompt: config.inputPrompt,
				options: {
					systemPrompt: systemPromptContent,
					allowedTools: config.allowedTools,
					maxTurns: config.maxTurns,
					permissionMode: "bypassPermissions",
					cwd: config.workingDir,
				},
			});

			for await (const msg of response) {
				// biome-ignore lint: SDK message types require runtime checks
				const m = msg as any;

				if (m.type === "assistant" && m.message?.content) {
					for (const block of m.message.content) {
						if (block.type === "tool_use") {
							lastToolName = block.name;
							this.emitter.emit({
								type: "agent:tool_call",
								agent: config.role,
								tool: block.name,
								input: block.input as Record<string, unknown>,
							});
						}
					}
				}

				if (m.type === "user" && m.message?.content) {
					for (const block of m.message.content) {
						if (block.type === "tool_result") {
							const raw = block.content;
							const content =
								typeof raw === "string"
									? raw
									: Array.isArray(raw)
										? raw.map((c: { text?: string }) => c.text ?? "").join("\n")
										: String(raw ?? "");
							this.emitter.emit({
								type: "agent:tool_result",
								agent: config.role,
								tool: lastToolName,
								result: content,
							});
						}
					}
				}

				if (m.type === "result" && m.subtype === "success") {
					resultText = m.result ?? "";
					if (resultText) {
						this.emitter.emit({
							type: "agent:output",
							agent: config.role,
							line: resultText,
						});
					}
				}
			}

			const durationMs = Date.now() - startTime;
			this.emitter.emit({
				type: "agent:exit",
				agent: config.role,
				exitCode: 0,
				durationMs,
			});
			return { exitCode: 0, stdout: resultText, stderr: "" };
		} catch (err) {
			const durationMs = Date.now() - startTime;
			const message = err instanceof Error ? err.message : String(err);
			this.emitter.emit({
				type: "error",
				message: `${config.role} failed: ${message}`,
			});
			this.emitter.emit({
				type: "agent:exit",
				agent: config.role,
				exitCode: 1,
				durationMs,
			});
			return { exitCode: 1, stdout: "", stderr: message };
		}
	}
}
