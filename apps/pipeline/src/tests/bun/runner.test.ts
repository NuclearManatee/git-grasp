import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { classifyError, EXIT_BY_CATEGORY } from "../../commons/errors.ts";
import { RunError, StepRunner } from "../../commons/runner.ts";
import { stepList } from "../../commons/stepSchema.ts";

describe("classifyError", () => {
	test("maps taxonomy", () => {
		expect(classifyError(new RunError("bad", "user"))).toBe("user");
		expect(classifyError(new Error("DEEPSEEK_API_KEY missing"))).toBe("environment");
		expect(classifyError(new Error("fetch failed ETIMEDOUT"))).toBe("external");
		expect(classifyError(new z.ZodError([]))).toBe("user");
		expect(EXIT_BY_CATEGORY.user).toBe(1);
		expect(EXIT_BY_CATEGORY.environment).toBe(2);
		expect(EXIT_BY_CATEGORY.external).toBe(3);
		expect(EXIT_BY_CATEGORY.internal).toBe(4);
	});
});

describe("StepRunner resume", () => {
	test("ctx.set stays bound after stepList.parse", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pipeline-runner-"));
		const dbPath = join(dir, "state.sqlite");
		const steps = stepList.parse([
			{
				name: "ctxProbe",
				run: async (ctx) => {
					const set = ctx.set;
					set("probe", { ok: true });
					expect(ctx.get("probe")).toEqual({ ok: true });
				},
				rollback: null,
				rollbackFn: null,
			},
		]);

		const runner = new StepRunner(dbPath, steps);
		await runner.run();
		runner.close();
		rmSync(dir, { recursive: true, force: true });
	});

	test("skips done steps on a second run", async () => {
		const dir = mkdtempSync(join(tmpdir(), "pipeline-runner-"));
		const dbPath = join(dir, "state.sqlite");
		const calls: string[] = [];
		const steps = stepList.parse([
			{
				name: "first",
				run: async () => {
					calls.push("first");
				},
				rollback: null,
				rollbackFn: null,
			},
			{
				name: "second",
				run: async () => {
					calls.push("second");
				},
				rollback: null,
				rollbackFn: null,
			},
		]);

		const firstRun = new StepRunner(dbPath, steps);
		await firstRun.run();
		firstRun.close();
		expect(calls).toEqual(["first", "second"]);

		const secondRun = new StepRunner(dbPath, steps);
		await secondRun.run();
		secondRun.close();
		expect(calls).toEqual(["first", "second"]);

		rmSync(dir, { recursive: true, force: true });
	});
});
