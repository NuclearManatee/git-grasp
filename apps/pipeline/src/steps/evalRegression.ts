import { existsSync } from "node:fs";
import { search, defaultDbPath, openDb, listRecipes } from "@git-grasp/common";
import {
	loadRegressionSet,
	evaluateRegressionSet,
	pruneRegressionSet,
	regressionSetPath,
} from "../../../../common/src/build/regressionSet.ts";
import { RunError } from "../commons/runner.ts";
import type { PipelineFlags } from "../commons/argv.ts";
import type { StepContext } from "../commons/stepSchema.ts";

export async function runEvalRegression(ctx: StepContext, flags: PipelineFlags): Promise<void> {
	const minAccuracy = flags.minAccuracy ?? 0.95;
	const forceMock =
		flags.mockEmbed || flags.mock || process.env.GIT_GRASP_MOCK_EMBEDDINGS === "1";
	const setPath = regressionSetPath();
	const dbPath = defaultDbPath();

	if (!existsSync(setPath)) {
		throw new RunError(`Regression set missing: ${setPath}`, "environment");
	}
	if (!existsSync(dbPath)) {
		throw new RunError(`Catalog DB missing: ${dbPath}. Run ship first.`, "environment");
	}

	let set = loadRegressionSet(setPath);
	if (!set.queries?.length) {
		throw new RunError(`Regression set empty: ${setPath}`, "user");
	}

	const catalog = openDb(dbPath, { readonly: true });
	let extantIds: Set<string>;
	try {
		extantIds = new Set(listRecipes(catalog).map((row: { id: string | number }) => String(row.id)));
	} finally {
		catalog.close();
	}
	const before = set.queries.length;
	set = pruneRegressionSet(set, extantIds);
	const pruned = before - set.queries.length;
	if (pruned > 0) {
		console.log({
			step: "evalRegression",
			prunedOrphanRecipeIds: pruned,
			queries: set.queries.length,
		});
	}
	if (!set.queries.length) {
		throw new RunError(`Regression set empty after pruning orphaned recipe_ids`, "user");
	}

	async function searchFn(query: string) {
		return search(query, { forceMockEmbeddings: forceMock, dbPath });
	}

	const result = await evaluateRegressionSet(set, {
		search: searchFn,
		minAccuracy,
		minTotal: 1,
	});
	ctx.set("evalRegression.accuracy", result.accuracy);
	ctx.set("evalRegression.total", result.total);
	console.log({
		step: "evalRegression",
		ok: result.ok,
		accuracy: result.accuracy,
		hits: result.hits,
		total: result.total,
		minAccuracy,
		mockEmbeddings: forceMock,
	});
	if (!result.ok) {
		throw new RunError("evalRegression below minAccuracy", "user");
	}
}
