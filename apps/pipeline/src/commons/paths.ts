import { join } from "node:path";
import { buildCacheDir } from "../../../../common/src/lib/paths.ts";

export function pipelineStateDbPath(): string {
	return join(buildCacheDir(), "pipeline-state.sqlite");
}
