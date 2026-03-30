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
