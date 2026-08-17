import { describe, expect, test } from "bun:test";
import { parsePipelineArgv } from "../../commons/argv.ts";
import { composePipelineSteps } from "../../commons/compose.ts";

describe("composePipelineSteps", () => {
	test("default catalog path", () => {
		expect(composePipelineSteps(parsePipelineArgv([]))).toEqual([
			"prepareScrape",
			"prepareGoals",
			"generate",
			"expand",
			"ship",
		]);
	});

	test("from=generate matches rebuild", () => {
		expect(composePipelineSteps(parsePipelineArgv(["--from=generate"]))).toEqual([
			"generate",
			"expand",
			"ship",
		]);
	});

	test("only=expand --fresh includes generate", () => {
		expect(composePipelineSteps(parsePipelineArgv(["--only=expand", "--fresh"]))).toEqual([
			"generate",
			"expand",
		]);
	});

	test("only=ship --dedupe inserts shipDedupe", () => {
		expect(composePipelineSteps(parsePipelineArgv(["--only=ship", "--dedupe"]))).toEqual([
			"shipDedupe",
			"ship",
		]);
	});

	test("evalRegression and evolve are conditional", () => {
		expect(
			composePipelineSteps(parsePipelineArgv(["--from=ship", "--eval-regression", "--evolve"])),
		).toEqual(["ship", "evalRegression", "evolve"]);
	});
});
