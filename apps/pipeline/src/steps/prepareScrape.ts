import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	buildGitCommandsTaxonomy,
	parseGitHelpAll,
	stripProbePathsForCommit,
} from "../../../../common/src/build/taxonomyScrape.ts";
import { spawnGit } from "../../../../common/src/build/gitExec.ts";
import { gitCommandsTaxonomyPath, localDir, PACKAGE_ROOT } from "../../../../common/src/lib/paths.ts";
import { RunError } from "../commons/runner.ts";
import type { StepContext } from "../commons/stepSchema.ts";

interface GitCommandRow {
	name: string;
	available?: boolean;
	runner?: string;
	command?: string;
}

interface GitCommandsTaxonomy {
	commands: GitCommandRow[];
	sections: { name: string }[];
	availability?: {
		available?: number;
		unavailable?: number;
		standalone?: number;
		total?: number;
	};
}

export async function runPrepareScrape(ctx: StepContext): Promise<void> {
	const result = spawnGit(["help", "-a"], {
		maxBuffer: 4 * 1024 * 1024,
	});
	if (result.error || result.status !== 0) {
		throw new RunError(
			String(result.stderr || result.error || `git help -a exited ${result.status}`),
			"environment",
		);
	}

	const parsed = parseGitHelpAll(String(result.stdout ?? ""));
	if (parsed.sections.length !== 3) {
		throw new RunError(
			`Expected 3 taxonomy sections, got ${parsed.sections.length}`,
			"user",
		);
	}
	if (parsed.commands.length < 20) {
		throw new RunError(
			`Suspiciously few commands: ${parsed.commands.length}`,
			"user",
		);
	}

	console.log({
		step: "prepareScrape",
		probing: parsed.commands.length,
	});
	const taxonomyFull = buildGitCommandsTaxonomy({
		sections: parsed.sections,
		scraped_at: Temporal.Now.instant().toString(),
		probe: true,
		keepRawDetail: true,
	}) as GitCommandsTaxonomy;

	const probeDir = join(localDir(), "prepare");
	mkdirSync(probeDir, { recursive: true });
	writeFileSync(
		join(probeDir, "scrape-probe.json"),
		`${JSON.stringify(taxonomyFull, null, 2)}\n`,
	);

	const taxonomy = stripProbePathsForCommit(taxonomyFull) as GitCommandsTaxonomy;
	const outPath = gitCommandsTaxonomyPath();
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(outPath, `${JSON.stringify(taxonomy, null, 2)}\n`);

	const availability = taxonomy.availability ?? {};
	ctx.set("prepareScrape.outPath", outPath);
	ctx.set("prepareScrape.commandCount", taxonomy.commands.length);
	console.log({
		step: "prepareScrape",
		commands: taxonomy.commands.length,
		sections: taxonomy.sections.length,
		available: availability.available ?? null,
		unavailable: availability.unavailable ?? null,
		standalone: availability.standalone ?? null,
	});
}

export async function rollbackPrepareScrape(): Promise<void> {
	const outPath = gitCommandsTaxonomyPath();
	if (!existsSync(outPath)) {
		return;
	}
	const result = spawnGit(["checkout", "--", "common/taxonomy/git_commands.json"], {
		cwd: PACKAGE_ROOT,
	});
	if (result.status !== 0) {
		throw new RunError(
			"git checkout of git_commands.json failed (restore manually)",
			"internal",
		);
	}
}
