import { existsSync, readFileSync } from "node:fs";
import { runBuildLoop } from "../../../../common/src/build/orchestrator.ts";
import { buildStagingDbPath, goalTaxonomyPath } from "../../../../common/src/lib/paths.ts";
import { RunError } from "../commons/runner.ts";
import type { PipelineFlags } from "../commons/argv.ts";
import type { StepContext } from "../commons/stepSchema.ts";
import { runHoldoutRetry } from "./expandRetry.ts";

export async function runExpand(ctx: StepContext, flags: PipelineFlags): Promise<void> {
	if (!existsSync(goalTaxonomyPath())) {
		throw new RunError(
			`Missing goal taxonomy: ${goalTaxonomyPath()}. Run prepareGoals first.`,
			"user",
		);
	}
	if (!flags.mock && !flags.mockEmbed) {
		delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;
	}

	if (flags.retryLeaves !== undefined) {
		if (!existsSync(flags.retryLeaves)) {
			throw new RunError(`retry leaves file missing: ${flags.retryLeaves}`, "user");
		}
		const failIds = readFileSync(flags.retryLeaves, "utf8")
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		const retryResult = await runHoldoutRetry({
			failIds,
			forceBroadcast: flags.forceBroadcast,
		});
		ctx.set("expand.retryRecovered", retryResult.recovered);
		ctx.set("expand.retryTargets", retryResult.targets);
		if (!retryResult.ok) {
			throw new RunError("expand retry failed holdout/regression gates", "user");
		}
		console.log({
			step: "expand",
			mode: "retry",
			ok: true,
			recovered: retryResult.recovered,
			targets: retryResult.targets,
			holdRate: retryResult.holdRate,
		});
		return;
	}

	if (!existsSync(buildStagingDbPath())) {
		throw new RunError(
			`Missing staging DB: ${buildStagingDbPath()}. Run generate first.`,
			"user",
		);
	}

	const result = await runBuildLoop({
		fresh: false,
		promote: flags.promote,
		forceBroadcast: flags.forceBroadcast,
		maxLeaves: flags.maxLeaves,
		maxBatches: flags.maxBatches,
		skipSandbox: flags.skipSandbox,
		skipLlmPlausibility: false,
		skipJudge: false,
		skipBackTranslate: false,
	});
	ctx.set("expand.corpusVersion", result.corpus?.version ?? null);
	console.log({
		step: "expand",
		ok: result.ok,
		corpus: result.corpus ?? null,
		regressionOk: result.regression?.ok ?? null,
		regressionAccuracy: result.regression?.accuracy ?? null,
		holdPass: result.holdPass ?? null,
		holdRate: result.holdRate ?? null,
		gapProposals: result.gapProposals?.length ?? 0,
	});
	if (!result.ok) {
		throw new RunError("expand failed held-out or regression gates", "user");
	}
}
