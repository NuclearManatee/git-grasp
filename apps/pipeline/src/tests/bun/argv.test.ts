import { describe, expect, test } from "bun:test";
import { parsePipelineArgv } from "../../commons/argv.ts";
import { RunError } from "../../commons/runner.ts";

describe("parsePipelineArgv", () => {
	test("parses catalog flags", () => {
		const flags = parsePipelineArgv([
			"--from=generate",
			"--fresh",
			"--max-leaves=3",
			"--max-batches=2",
			"--skip-sandbox",
		]);
		expect(flags.from).toBe("generate");
		expect(flags.fresh).toBe(true);
		expect(flags.maxLeaves).toBe(3);
		expect(flags.maxBatches).toBe(2);
		expect(flags.skipSandbox).toBe(true);
	});

	test("positional becomes retryLeaves", () => {
		const flags = parsePipelineArgv(["local/holdout-failed-leaves.txt"]);
		expect(flags.retryLeaves).toBe("local/holdout-failed-leaves.txt");
	});

	test("rejects unknown flags", () => {
		expect(() => parsePipelineArgv(["--nope"])).toThrow(RunError);
	});

	test("rejects --from and --only together", () => {
		expect(() => parsePipelineArgv(["--from=generate", "--only=ship"])).toThrow(RunError);
	});

	test("rejects non-integer max-leaves", () => {
		expect(() => parsePipelineArgv(["--max-leaves=1.5"])).toThrow(RunError);
	});
});
