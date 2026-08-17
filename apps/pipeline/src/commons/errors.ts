import { z } from "zod";
import { RunError, type ErrorCategory } from "./runner.ts";

export const EXIT_BY_CATEGORY: Record<ErrorCategory, number> = {
	user: 1,
	environment: 2,
	external: 3,
	internal: 4,
};

export function classifyError(error: unknown): ErrorCategory {
	if (error instanceof RunError) {
		return error.category;
	}
	if (error instanceof z.ZodError) {
		return "user";
	}
	const message = error instanceof Error ? error.message : String(error);
	if (
		/API_KEY missing|missing \(set in environment|Bun is missing|git-commands\.db/i.test(
			message,
		)
	) {
		return "environment";
	}
	if (
		/ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|RATE_LIMIT|429|socket/i.test(
			message,
		)
	) {
		return "external";
	}
	if (
		/Missing goal taxonomy|refused|invalid|bad args|Zod|orphaned state/i.test(
			message,
		)
	) {
		return "user";
	}
	return "internal";
}

export function toRunError(error: unknown): RunError {
	if (error instanceof RunError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	return new RunError(message, classifyError(error));
}
