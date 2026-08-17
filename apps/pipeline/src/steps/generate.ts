import { existsSync, rmSync } from "node:fs";
import { runGroundStep } from "../../../../common/src/build/orchestrator.ts";
import { buildStagingDbPath, goalTaxonomyPath } from "../../../../common/src/lib/paths.ts";
import { RunError } from "../commons/runner.ts";
import type { PipelineFlags } from "../commons/argv.ts";
import type { StepContext } from "../commons/stepSchema.ts";

export async function runGenerate(ctx: StepContext, flags: PipelineFlags): Promise<void> {
	if (!existsSync(goalTaxonomyPath())) {
		throw new RunError(
			`Missing goal taxonomy: ${goalTaxonomyPath()}. Run prepareGoals first.`,
			"user",
		);
	}
	if (!flags.mock && !flags.mockEmbed) {
		delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;
	}
	const result = await runGroundStep({
		fresh: true,
		maxLeaves: flags.maxLeaves,
		maxBatches: flags.maxBatches,
		skipSandbox: flags.skipSandbox,
	});
	if (!result.ok) {
		throw new RunError("generate failed (ground checkpoint)", "external");
	}
	ctx.set("generate.stagingDb", buildStagingDbPath());
	console.log({
		step: "generate",
		ok: true,
		checkpointRate: result.checkpointRate ?? null,
		errorRate: result.errorRate ?? null,
		leaves: result.acceptedLeaves ?? null,
	});
}

export async function rollbackGenerate(): Promise<void> {
	const stagingPath = buildStagingDbPath();
	if (existsSync(stagingPath)) {
		rmSync(stagingPath);
	}
}
