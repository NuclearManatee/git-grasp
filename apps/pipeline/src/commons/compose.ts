import {
	CATALOG_STEPS,
	type PipelineFlags,
	type PipelineStepName,
} from "./argv.ts";

function insertConditionals(
	names: PipelineStepName[],
	flags: PipelineFlags,
): PipelineStepName[] {
	const composed: PipelineStepName[] = [];
	for (const name of names) {
		if (name === "ship" && (flags.dedupe || flags.seed)) {
			composed.push("shipDedupe");
		}
		composed.push(name);
		if (name === "ship" && flags.evalRegression) {
			composed.push("evalRegression");
		}
	}
	if (flags.evolve && !composed.includes("evolve")) {
		composed.push("evolve");
	}
	return composed;
}

export function composePipelineSteps(flags: PipelineFlags): PipelineStepName[] {
	if (flags.only !== undefined) {
		if (flags.only === "expand" && flags.fresh) {
			return insertConditionals(["generate", "expand"], flags);
		}
		if (flags.only === "shipDedupe" && flags.seed) {
			return insertConditionals(["shipDedupe", "ship"], flags);
		}
		return insertConditionals([flags.only], flags);
	}

	const catalog = [...CATALOG_STEPS];
	if (flags.from !== undefined) {
		if (flags.from === "shipDedupe" || flags.from === "evalRegression" || flags.from === "evolve") {
			return insertConditionals([flags.from], flags);
		}
		const start = catalog.indexOf(flags.from as (typeof CATALOG_STEPS)[number]);
		if (start < 0) {
			return insertConditionals([flags.from], flags);
		}
		return insertConditionals(catalog.slice(start), flags);
	}

	return insertConditionals(catalog, flags);
}
