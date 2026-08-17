import { existsSync } from "node:fs";
import pLimit from "p-limit";
import {
	openDb,
	finalizeSearchIndex,
	listRecipes,
	appendParaphrase,
	recipeEmbedText,
	upsertRecipeEmbedding,
	knnRecall,
	ftsRecall,
	getRecipe,
	loadGitVerbs,
} from "../../../../common/src/db/schema.ts";
import { buildStagingDbPath, goalTaxonomyPath } from "../../../../common/src/lib/paths.ts";
import { readGoalTaxonomy } from "../../../../common/src/build/goalTaxonomy.ts";
import { runLeafHoldout } from "../../../../common/src/build/leafHoldout.ts";
import {
	triageFailure,
	applyTriageAction,
	classifyMissHeuristic,
} from "../../../../common/src/build/improveTriage.ts";
import {
	loadRegressionSet,
	saveRegressionSet,
	addRegressionQueries,
	evaluateRegressionSet,
} from "../../../../common/src/build/regressionSet.ts";
import { writeCorpusVersion } from "../../../../common/src/build/corpusVersion.ts";
import { getEmbedder } from "../../../../common/src/search/embed.ts";
import { searchHybrid, normalizeQuery } from "../../../../common/src/search/hybrid.ts";
import { loadThresholds } from "../../../../common/src/search/index.ts";
import { parseCommands, primaryCommand, renderSnippet } from "../../../../common/src/db/recipeFormat.ts";
import { HELDOUT_IMPROVE_ROUNDS } from "../../../../common/src/db/constants.ts";
import { RunError } from "../commons/runner.ts";

export interface HoldoutRetryResult {
	ok: boolean;
	recovered: number;
	targets: number;
	holdRate: number;
}

export async function runHoldoutRetry(opts: {
	failIds: string[];
	forceBroadcast: boolean;
}): Promise<HoldoutRetryResult> {
	const stagingPath = buildStagingDbPath();
	if (!existsSync(stagingPath)) {
		throw new RunError(`Missing staging DB: ${stagingPath}`, "user");
	}
	if (!existsSync(goalTaxonomyPath())) {
		throw new RunError(`Missing goal taxonomy: ${goalTaxonomyPath()}`, "user");
	}

	const db = openDb(stagingPath);
	const tax = readGoalTaxonomy(goalTaxonomyPath());
	const allLeaves = tax.leaves ?? [];
	const recipesByLeaf = new Set(listRecipes(db).map((row: { taxonomy_leaf: string }) => row.taxonomy_leaf));
	const { failIds } = opts;
	const targetLeaves = failIds.length > 0
		? allLeaves.filter((leaf: { id: string }) => failIds.includes(leaf.id))
		: allLeaves.filter((leaf: { id: string }) => recipesByLeaf.has(leaf.id));

	const embedder = await getEmbedder({});
	const thresholds = loadThresholds();
	const verbs = loadGitVerbs(db);
	async function search(query: string) {
		const normalized = normalizeQuery(query);
		return searchHybrid({
			query: normalized,
			thresholds,
			verbs,
			embed: () => embedder.embed(normalized),
			knn: (vec, k) => knnRecall(db, vec, k),
			fts: (term, k) => ftsRecall(db, term, k),
			hydrate: (ids) =>
				ids.map((id) => {
					const row = getRecipe(db, id);
					if (!row) {
						return {
							command_id: id,
							commands: [],
							example: "",
							snippet: "",
							title: "",
							description: "",
							risk: 0,
						};
					}
					const commands = parseCommands(row.commands);
					return {
						command_id: row.id,
						commands,
						example: primaryCommand(commands),
						snippet: renderSnippet(commands),
						title: row.title,
						description: row.description,
						risk: row.risk,
					};
				}),
		});
	}

	const improveRounds = Math.max(HELDOUT_IMPROVE_ROUNDS, 8);
	const limit = pLimit(6);
	const results = await Promise.all(
		targetLeaves.map((leaf: { id: string }) =>
			limit(async () => {
				try {
					let hold = await runLeafHoldout(leaf, { db, search });
					let attempts = 0;
					while (!hold.ok && attempts < improveRounds) {
						attempts += 1;
						const lastFail = [...(hold.rounds ?? [])].reverse().find((round: { passed: boolean }) => !round.passed);
						for (const row of lastFail?.results ?? []) {
							if (row.hit) {
								continue;
							}
							const failure = {
								query: row.query,
								...(row.expectedId ? { expectedId: String(row.expectedId) } : {}),
								displayedIds: row.displayed,
								leafId: leaf.id,
								leafIds: targetLeaves.map((item: { id: string }) => item.id),
								hit: false,
								correctExists: Boolean(row.expectedId),
							};
							let classification;
							try {
								classification = await triageFailure(failure, {});
							} catch {
								classification = classifyMissHeuristic(failure);
							}
							await applyTriageAction(classification || classifyMissHeuristic(failure), failure, {
								db,
								leaf,
								leaves: allLeaves,
								search,
								embed: (text: string) => embedder.embed(text),
							});
						}
						finalizeSearchIndex(db);
						hold = await runLeafHoldout(leaf, { db, search });
					}
					if (!hold.ok && opts.forceBroadcast) {
						const lastFail = [...(hold.rounds ?? [])].reverse().find((round: { passed: boolean }) => !round.passed);
						const recipes = listRecipes(db).filter((row: { taxonomy_leaf: string }) => row.taxonomy_leaf === leaf.id);
						for (const row of lastFail?.results ?? []) {
							if (row.hit) {
								continue;
							}
							for (const recipe of recipes) {
								appendParaphrase(db, recipe.id, row.query);
								const embedding = await embedder.embed(
									recipeEmbedText({
										...recipe,
										paraphrases: [...(recipe.paraphrases ?? []), row.query],
									}),
								);
								upsertRecipeEmbedding(db, recipe.id, embedding);
							}
						}
						finalizeSearchIndex(db);
						for (let index = 0; index < 3 && !hold.ok; index += 1) {
							hold = await runLeafHoldout(leaf, { db, search });
						}
					}
					return { leafId: leaf.id, ...hold };
				} catch (error) {
					return {
						leafId: leaf.id,
						ok: false,
						rounds: [],
						error: error instanceof Error ? error.message : String(error),
					};
				}
			}),
		),
	);

	const recovered = results.filter((row: { ok: boolean }) => row.ok).length;
	const eligible = allLeaves.filter((leaf: { id: string }) => recipesByLeaf.has(leaf.id));
	const previouslyOk = eligible.length - failIds.length;
	const nowOk = previouslyOk + recovered;
	const holdRate = eligible.length ? nowOk / eligible.length : 0;

	let regression = {
		version: 0,
		queries: (loadRegressionSet().queries ?? []).filter(
			(query: { source: string }) => query.source === "real" || query.source === "triage",
		),
	};
	const extant = new Set(listRecipes(db).map((row: { id: string }) => String(row.id)));
	regression.queries = regression.queries.filter((query: { recipe_id: string }) =>
		extant.has(String(query.recipe_id)),
	);
	for (const hold of results) {
		if (!hold.ok) {
			continue;
		}
		for (const round of hold.rounds ?? []) {
			if (!round.passed) {
				continue;
			}
			for (const row of round.results ?? []) {
				if (!row.hit) {
					continue;
				}
				regression = addRegressionQueries(regression, [
					{
						query: row.query,
						recipe_id: row.expectedId,
						source: "heldout",
						leaf_id: hold.leafId,
					},
				]);
			}
		}
	}
	const prior = loadRegressionSet();
	for (const query of prior.queries ?? []) {
		if (query.source !== "heldout") {
			continue;
		}
		if (!extant.has(String(query.recipe_id))) {
			continue;
		}
		regression = addRegressionQueries(regression, [query]);
	}
	saveRegressionSet(regression);
	const regEval = await evaluateRegressionSet(regression, { search, minAccuracy: 0.95 });
	const minHold = 0.8;
	const ok = Boolean(regEval.ok) && holdRate >= minHold;
	if (ok) {
		writeCorpusVersion(db, {});
	}
	finalizeSearchIndex(db);
	db.close();
	return {
		ok,
		recovered,
		targets: results.length,
		holdRate,
	};
}
