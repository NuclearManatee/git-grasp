import "@js-temporal/polyfill";
import { existsSync, rmSync } from "node:fs";
import { parseLlmEnv } from "@git-grasp/common";
import { buildStagingDbPath } from "../../../common/src/lib/paths.ts";
import {
	parsePipelineArgv,
	PIPELINE_HELP,
	type PipelineFlags,
	type PipelineStepName,
} from "./commons/argv.ts";
import { composePipelineSteps } from "./commons/compose.ts";
import { EXIT_BY_CATEGORY, toRunError } from "./commons/errors.ts";
import { pipelineStateDbPath } from "./commons/paths.ts";
import { StepRunner } from "./commons/runner.ts";
import { stepList, type StepDef } from "./commons/stepSchema.ts";
import { runEvalRegression } from "./steps/evalRegression.ts";
import { runEvolveStep, rollbackEvolve } from "./steps/evolve.ts";
import { runExpand } from "./steps/expand.ts";
import { runGenerate, rollbackGenerate } from "./steps/generate.ts";
import { runPrepareGoals, rollbackPrepareGoals } from "./steps/prepareGoals.ts";
import { runPrepareScrape, rollbackPrepareScrape } from "./steps/prepareScrape.ts";
import { runShip } from "./steps/ship.ts";
import { runShipDedupe } from "./steps/shipDedupe.ts";

function buildStepDefs(flags: PipelineFlags, names: PipelineStepName[]): StepDef[] {
	const defs: StepDef[] = [];
	for (const name of names) {
		if (name === "prepareScrape") {
			defs.push({
				name,
				run: (ctx) => runPrepareScrape(ctx),
				rollback: "git checkout common/taxonomy/git_commands.json",
				rollbackFn: () => rollbackPrepareScrape(),
			});
			continue;
		}
		if (name === "prepareGoals") {
			defs.push({
				name,
				run: (ctx) => runPrepareGoals(ctx),
				rollback: "git checkout common/taxonomy/goal_taxonomy.json (LLM spend is not refundable)",
				rollbackFn: () => rollbackPrepareGoals(),
			});
			continue;
		}
		if (name === "generate") {
			defs.push({
				name,
				run: (ctx) => runGenerate(ctx, flags),
				rollback: "delete local/cache/build/staging.db (LLM spend is not refundable)",
				rollbackFn: () => rollbackGenerate(),
			});
			continue;
		}
		if (name === "expand") {
			defs.push({
				name,
				run: (ctx) => runExpand(ctx, flags),
				rollback: "git restore recipes.vN.json / regression.json (LLM spend is not refundable)",
				rollbackFn: null,
			});
			continue;
		}
		if (name === "shipDedupe") {
			defs.push({
				name,
				run: (ctx) => runShipDedupe(ctx),
				rollback: "git restore common/data/catalog recipes.json and versions",
				rollbackFn: null,
			});
			continue;
		}
		if (name === "ship") {
			defs.push({
				name,
				run: (ctx) => runShip(ctx, flags),
				rollback: "git restore common/data/git-commands.db and .sha256",
				rollbackFn: null,
			});
			continue;
		}
		if (name === "evalRegression") {
			defs.push({
				name,
				run: (ctx) => runEvalRegression(ctx, flags),
				rollback: null,
				rollbackFn: null,
			});
			continue;
		}
		if (name === "evolve") {
			defs.push({
				name,
				run: (ctx) => runEvolveStep(ctx, flags),
				rollback: "restore local/evolve/cursor.json from the step snapshot",
				rollbackFn: (ctx) => rollbackEvolve(ctx),
			});
		}
	}
	return defs;
}

function resetFreshState(): void {
	const stagingPath = buildStagingDbPath();
	if (existsSync(stagingPath)) {
		rmSync(stagingPath);
	}
	const statePath = pipelineStateDbPath();
	if (existsSync(statePath)) {
		rmSync(statePath);
	}
}

async function main(): Promise<void> {
	try {
		parseLlmEnv();
		const flags = parsePipelineArgv(process.argv.slice(2));
		if (flags.help) {
			console.log(PIPELINE_HELP);
			return;
		}

		if (flags.fresh) {
			resetFreshState();
		}

		const names = composePipelineSteps(flags);
		const steps = stepList.parse(buildStepDefs(flags, names));
		const runner = new StepRunner(pipelineStateDbPath(), steps, {
			confirmOrphans: flags.confirmOrphans ? () => true : undefined,
			onManualRollback: (step, rollback) => {
				console.log({ step, status: "manual-rollback", rollback });
			},
		});

		try {
			await runner.run();
			console.log({ ok: true, steps: names });
		} catch (error) {
			const runError = toRunError(error);
			console.log({ error: runError.message, category: runError.category });
			process.exitCode = EXIT_BY_CATEGORY[runError.category];
		} finally {
			runner.close();
		}
	} catch (error) {
		const runError = toRunError(error);
		console.log({ error: runError.message, category: runError.category });
		process.exitCode = EXIT_BY_CATEGORY[runError.category];
	}
}

if (import.meta.main) {
	await main();
}
