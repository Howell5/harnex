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
			createMockStream([{ type: "result", subtype: "success", result: "" }]) as ReturnType<
				typeof query
			>,
		);

		const slug = await generateTaskSlug("Some task");
		expect(slug).toMatch(/^task-\d{4}-\d{2}-\d{2}-\d{3}$/);
	});
});
