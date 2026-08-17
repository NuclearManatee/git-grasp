import { z } from "zod";

// Step orchestration schema — from the Script Forge rulebook (Step
// Orchestration), as a working file. Scripts copy this file into
// scripts/<name>/commons/ together with runner.ts.
//
// Why the API differs from the rulebook's example: the rulebook shows the
// zod-3 names (.args()/.returns()); projects pin zod ^4 (must-have), which
// replaced them with .input([...])/.output(...). This file is the version
// that runs with the pinned zod.

export const stepContext = z.object({
	get: z.function().input([z.string()]).output(z.unknown()),
	set: z.function().input([z.string(), z.unknown()]).output(z.void()),
});
export type StepContext = z.infer<typeof stepContext>;

export const stepDef = z.object({
	name: z.string(),                  // must match stepRow.step in the state db
	run: z.function().input([stepContext]).output(z.promise(z.void())),
	rollback: z.string().nullable(),   // description of compensating action, or null
	rollbackFn: z.function().input([stepContext]).output(z.promise(z.void())).nullable(),
});
export type StepDef = z.infer<typeof stepDef>;

export const stepList = z.array(stepDef).min(1);
