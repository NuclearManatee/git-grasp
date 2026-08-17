import { seedCatalog } from "@git-grasp/common";
import { RunError } from "../commons/runner.ts";
import type { PipelineFlags } from "../commons/argv.ts";
import type { StepContext } from "../commons/stepSchema.ts";

export async function runShip(ctx: StepContext, flags: PipelineFlags): Promise<void> {
	const forceMock = flags.mock || flags.mockEmbed || process.env.GIT_GRASP_MOCK_EMBEDDINGS === "1";
	try {
		const result = await seedCatalog({ forceMock });
		ctx.set("ship.recipes", result.recipes);
		ctx.set("ship.hash", result.hash);
		console.log({
			step: "ship",
			recipes: result.recipes,
			inserted: result.n,
			skipped: result.skipped,
			mock: result.mock,
		});
	} catch (error) {
		throw new RunError(
			error instanceof Error ? error.message : String(error),
			"internal",
		);
	}
}
