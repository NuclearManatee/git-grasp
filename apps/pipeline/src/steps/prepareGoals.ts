import { existsSync } from "node:fs";
import { buildGoalTaxonomy } from "../../../../common/src/build/goalTaxonomy.ts";
import { gitCommandsTaxonomyPath, goalTaxonomyPath, PACKAGE_ROOT } from "../../../../common/src/lib/paths.ts";
import { spawnGit } from "../../../../common/src/build/gitExec.ts";
import { RunError } from "../commons/runner.ts";
import type { StepContext } from "../commons/stepSchema.ts";

export async function runPrepareGoals(ctx: StepContext): Promise<void> {
	if (!existsSync(gitCommandsTaxonomyPath())) {
		throw new RunError(
			`Missing scraped commands: ${gitCommandsTaxonomyPath()}. Run prepareScrape first.`,
			"user",
		);
	}
	delete process.env.GIT_GRASP_MOCK_EMBEDDINGS;
	const result = await buildGoalTaxonomy({ fresh: true });
	if (!result.ok) {
		throw new RunError("prepareGoals failed", "external");
	}
	ctx.set("prepareGoals.outPath", result.outPath);
	ctx.set("prepareGoals.leafCount", result.leaves?.length ?? 0);
	console.log({
		step: "prepareGoals",
		ok: true,
		leaves: result.leaves?.length ?? 0,
		coverage: result.coverage ?? null,
		reflectionRounds: result.reflection_rounds ?? null,
	});
}

export async function rollbackPrepareGoals(): Promise<void> {
	const outPath = goalTaxonomyPath();
	if (!existsSync(outPath)) {
		return;
	}
	const result = spawnGit(["checkout", "--", "common/taxonomy/goal_taxonomy.json"], {
		cwd: PACKAGE_ROOT,
	});
	if (result.status !== 0) {
		throw new RunError(
			"git checkout of goal_taxonomy.json failed (restore manually)",
			"internal",
		);
	}
}
