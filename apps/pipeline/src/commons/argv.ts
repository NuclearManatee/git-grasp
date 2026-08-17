import { z } from "zod";
import { RunError } from "./runner.ts";

export const PIPELINE_STEPS = [
	"prepareScrape",
	"prepareGoals",
	"generate",
	"expand",
	"shipDedupe",
	"ship",
	"evalRegression",
	"evolve",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export const CATALOG_STEPS = [
	"prepareScrape",
	"prepareGoals",
	"generate",
	"expand",
	"ship",
] as const;

const stepNameSchema = z.enum(PIPELINE_STEPS);

function optionalPositiveInt(value: string | undefined): number | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	const parsed = Number(value);
	if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
		throw new RunError(`expected a positive integer, got ${value}`, "user");
	}
	return parsed;
}

function optionalAccuracy(value: string | undefined): number | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	const parsed = Number(value);
	if (Number.isNaN(parsed) || parsed < 0 || parsed > 1) {
		throw new RunError(`expected accuracy in [0, 1], got ${value}`, "user");
	}
	return parsed;
}

export const pipelineFlagsSchema = z.object({
	help: z.boolean(),
	fresh: z.boolean(),
	from: stepNameSchema.optional(),
	only: stepNameSchema.optional(),
	promote: z.boolean(),
	forceBroadcast: z.boolean(),
	maxLeaves: z.number().int().positive().optional(),
	maxBatches: z.number().int().positive().optional(),
	skipSandbox: z.boolean(),
	dedupe: z.boolean(),
	seed: z.boolean(),
	evolve: z.boolean(),
	evalRegression: z.boolean(),
	retryLeaves: z.string().optional(),
	mock: z.boolean(),
	mockEmbed: z.boolean(),
	minAccuracy: z.number().min(0).max(1).optional(),
	noChain: z.boolean(),
	llmLabel: z.boolean(),
	ship: z.boolean(),
	shipUnsafe: z.boolean(),
	catalogVersion: z.string().optional(),
	confirmOrphans: z.boolean(),
});

export type PipelineFlags = z.infer<typeof pipelineFlagsSchema>;

export function parsePipelineArgv(argv: string[]): PipelineFlags {
	let help = false;
	let fresh = false;
	let from: PipelineStepName | undefined;
	let only: PipelineStepName | undefined;
	let promote = false;
	let forceBroadcast = false;
	let maxLeaves: number | undefined;
	let maxBatches: number | undefined;
	let skipSandbox = false;
	let dedupe = false;
	let seed = false;
	let evolve = false;
	let evalRegression = false;
	let retryLeaves: string | undefined;
	let mock = false;
	let mockEmbed = false;
	let minAccuracy: number | undefined;
	let noChain = false;
	let llmLabel = false;
	let ship = false;
	let shipUnsafe = false;
	let catalogVersion: string | undefined;
	let confirmOrphans = false;
	const positionals: string[] = [];

	for (const arg of argv) {
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--fresh") {
			fresh = true;
			continue;
		}
		if (arg === "--promote") {
			promote = true;
			continue;
		}
		if (arg === "--force-broadcast") {
			forceBroadcast = true;
			continue;
		}
		if (arg === "--skip-sandbox") {
			skipSandbox = true;
			continue;
		}
		if (arg === "--dedupe") {
			dedupe = true;
			continue;
		}
		if (arg === "--seed") {
			seed = true;
			continue;
		}
		if (arg === "--evolve") {
			evolve = true;
			continue;
		}
		if (arg === "--eval-regression") {
			evalRegression = true;
			continue;
		}
		if (arg === "--mock") {
			mock = true;
			continue;
		}
		if (arg === "--mock-embed") {
			mockEmbed = true;
			continue;
		}
		if (arg === "--no-chain") {
			noChain = true;
			continue;
		}
		if (arg === "--llm-label") {
			llmLabel = true;
			continue;
		}
		if (arg === "--ship") {
			ship = true;
			continue;
		}
		if (arg === "--ship-unsafe") {
			shipUnsafe = true;
			continue;
		}
		if (arg === "--confirm-orphans") {
			confirmOrphans = true;
			continue;
		}
		if (arg.startsWith("--from=")) {
			from = stepNameSchema.parse(arg.slice("--from=".length));
			continue;
		}
		if (arg.startsWith("--only=")) {
			only = stepNameSchema.parse(arg.slice("--only=".length));
			continue;
		}
		if (arg.startsWith("--max-leaves=")) {
			maxLeaves = optionalPositiveInt(arg.slice("--max-leaves=".length));
			continue;
		}
		if (arg.startsWith("--max-batches=")) {
			maxBatches = optionalPositiveInt(arg.slice("--max-batches=".length));
			continue;
		}
		if (arg.startsWith("--retry-leaves=")) {
			retryLeaves = arg.slice("--retry-leaves=".length);
			continue;
		}
		if (arg.startsWith("--min-accuracy=")) {
			minAccuracy = optionalAccuracy(arg.slice("--min-accuracy=".length));
			continue;
		}
		if (arg.startsWith("--catalog-version=")) {
			catalogVersion = arg.slice("--catalog-version=".length);
			continue;
		}
		if (arg.startsWith("-")) {
			throw new RunError(`unknown flag: ${arg}`, "user");
		}
		positionals.push(arg);
	}

	if (from !== undefined && only !== undefined) {
		throw new RunError("use either --from or --only, not both", "user");
	}

	if (retryLeaves === undefined && positionals[0] !== undefined) {
		retryLeaves = positionals[0];
	} else if (positionals.length > 1 || (positionals.length === 1 && retryLeaves !== undefined && positionals[0] !== retryLeaves)) {
		throw new RunError(`unexpected arguments: ${positionals.join(" ")}`, "user");
	}

	return pipelineFlagsSchema.parse({
		help,
		fresh,
		from,
		only,
		promote,
		forceBroadcast,
		maxLeaves,
		maxBatches,
		skipSandbox,
		dedupe,
		seed,
		evolve,
		evalRegression,
		retryLeaves,
		mock,
		mockEmbed,
		minAccuracy,
		noChain,
		llmLabel,
		ship,
		shipUnsafe,
		catalogVersion,
		confirmOrphans,
	});
}

export const PIPELINE_HELP = `Usage: bun run tools:pipeline [flags]

  --from=<step>           start at this catalog step (inclusive)
  --only=<step>           run a single step
  --fresh                 wipe staging.db and the step-state DB
  --promote               after expand, promote staging → product DB
  --force-broadcast       last-ditch miss→all-leaf paraphrases
  --max-leaves=N          smoke: N diverse taxonomy leaves
  --max-batches=N         discovery batches per leaf
  --skip-sandbox          skip git sandbox (debug)
  --dedupe                run shipDedupe before ship
  --seed                  with --only=shipDedupe, also run ship
  --eval-regression       run evalRegression after ship
  --evolve                run evolve after the catalog path
  --retry-leaves=<file>   expand retries the listed leaf ids
  --mock / --mock-embed   mock embeddings (seed / regression smoke)
  --min-accuracy=0.95     evalRegression gate
  --no-chain              evolve: stop after feeder
  --llm-label             evolve: LLM-confirm weak/abandon labels
  --ship / --ship-unsafe  evolve: promote after chain
  --catalog-version=N     evolve: require this catalog_version
  --confirm-orphans       resume despite orphaned state rows
  --help

Steps: ${PIPELINE_STEPS.join(", ")}
`;
