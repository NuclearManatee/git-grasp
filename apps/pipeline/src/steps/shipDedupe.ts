import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { catalogDir } from "../../../../common/src/lib/paths.ts";
import { mergeRecipesByStructuralFingerprint } from "../../../../common/src/build/mergeRecipes.ts";
import {
	nextCorpusVersion,
	corpusVersionsDir,
	latestCorpusMetaPath,
} from "../../../../common/src/build/corpusVersion.ts";
import { RunError } from "../commons/runner.ts";
import type { StepContext } from "../commons/stepSchema.ts";

export async function runShipDedupe(ctx: StepContext): Promise<void> {
	const recipesPath = join(catalogDir(), "recipes.json");
	const v4Path = join(catalogDir(), "versions", "recipes.v4.json");

	let sourcePath = recipesPath;
	if (!existsSync(sourcePath) && existsSync(v4Path)) {
		sourcePath = v4Path;
	}
	if (!existsSync(sourcePath)) {
		throw new RunError("No recipes.json / recipes.v4.json found", "user");
	}

	if (existsSync(v4Path)) {
		console.log({ step: "shipDedupe", preservedArchive: v4Path });
	} else if (existsSync(recipesPath)) {
		const archive = join(catalogDir(), "versions", "recipes.v4.pre-dedupe.json");
		mkdirSync(dirname(archive), { recursive: true });
		if (!existsSync(archive)) {
			copyFileSync(recipesPath, archive);
			console.log({ step: "shipDedupe", archived: archive });
		}
	}

	const raw: unknown = JSON.parse(readFileSync(sourcePath, "utf8"));
	let input: unknown[] = [];
	if (Array.isArray(raw)) {
		input = raw;
	} else if (raw !== null && typeof raw === "object" && Array.isArray((raw as { recipes?: unknown }).recipes)) {
		input = (raw as { recipes: unknown[] }).recipes;
	}

	const merged = mergeRecipesByStructuralFingerprint(input, { scope: "leaf" });
	const version = nextCorpusVersion();
	const dir = corpusVersionsDir();
	mkdirSync(dir, { recursive: true });
	const createdAt = Temporal.Now.instant().toString();
	const doc = {
		version,
		created_at: createdAt,
		recipe_count: merged.recipes.length,
		recipes: merged.recipes,
		dedupe: {
			from: sourcePath,
			before: merged.before,
			after: merged.after,
			removed: merged.removed,
			scope: "leaf",
		},
	};
	const versionPath = join(dir, `recipes.v${version}.json`);
	writeFileSync(versionPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
	writeFileSync(
		join(catalogDir(), "recipes.json"),
		`${JSON.stringify(merged.recipes, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(
		join(catalogDir(), "commands.json"),
		`${JSON.stringify(merged.recipes, null, 2)}\n`,
		"utf8",
	);
	writeFileSync(
		latestCorpusMetaPath(),
		`${JSON.stringify(
			{
				version,
				path: versionPath,
				recipe_count: merged.recipes.length,
				created_at: createdAt,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	ctx.set("shipDedupe.version", version);
	ctx.set("shipDedupe.removed", merged.removed);
	console.log({
		step: "shipDedupe",
		before: merged.before,
		after: merged.after,
		removed: merged.removed,
		version,
	});
}
