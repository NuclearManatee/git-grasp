import { runEvolve } from "@git-grasp/common/evolve";
import { readEvolveCursor, writeEvolveCursor } from "../../../../common/src/evolve/cursor.ts";
import { repoRoot } from "../../../../common/src/evolve/paths.ts";
import { RunError } from "../commons/runner.ts";
import type { PipelineFlags } from "../commons/argv.ts";
import type { StepContext } from "../commons/stepSchema.ts";

export async function runEvolveStep(ctx: StepContext, flags: PipelineFlags): Promise<void> {
	const root = repoRoot();
	const cursorBefore = readEvolveCursor(root);
	ctx.set("evolve.cursorBefore", cursorBefore);

	const result = await runEvolve({
		noChain: flags.noChain,
		llmLabel: flags.llmLabel,
		ship: flags.ship || flags.shipUnsafe,
		shipUnsafe: flags.shipUnsafe,
		catalogVersion: flags.catalogVersion,
		allowVersionBump: flags.ship,
	});
	ctx.set("evolve.ok", result.ok);
	ctx.set("evolve.refused", result.refused);
	console.log({
		step: "evolve",
		ok: result.ok,
		refused: result.refused,
		feederTrain: result.feederTrain?.length ?? 0,
		feederHoldout: result.feederHoldout?.length ?? 0,
	});
	if (!result.ok && !result.refused) {
		throw new RunError("evolve failed", "external");
	}
}

export async function rollbackEvolve(ctx: StepContext): Promise<void> {
	const cursorBefore = ctx.get("evolve.cursorBefore");
	if (cursorBefore === undefined) {
		return;
	}
	writeEvolveCursor(cursorBefore, repoRoot());
}
