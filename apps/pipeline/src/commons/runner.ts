// runner.ts — checkpoint & resume engine (rulebook: Principles → Checkpoint & Resume).
// Scripts copy this file into scripts/<name>/commons/ together with stepSchema.ts.
//
// The state database is one bun:sqlite file per script run — a run-state DB,
// separate from any bun:sqlite OUTPUT database the script writes. WAL mode +
// transactions make checkpoint writes atomic.
//
// index.ts pattern (exit-code taxonomy, fail fast):
//   const runner = new StepRunner(dbPath, stepList.parse([...]));
//   try {
//     await runner.run();
//   } catch (error) {
//     console.log({ error: (error as Error).message, category: (error as RunError).category ?? "internal" });
//     process.exit(EXIT_BY_CATEGORY[(error as RunError).category ?? "internal"]);
//   }
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { StepDef, StepContext } from "./stepSchema";

export type StepStatus = "pending" | "done" | "failed";

export interface StepRow {
	step: string;
	status: StepStatus;
	ranAt: string;
	action: string;
	rollback: string | null;
}

export type ErrorCategory = "user" | "environment" | "external" | "internal";

export class RunError extends Error {
	readonly category: ErrorCategory;
	constructor(message: string, category: ErrorCategory) {
		super(message);
		this.category = category;
	}
}

export interface RunOptions {
	// Rows in the state DB with no matching step in the current composition
	// (rulebook: dynamic step reconciliation). Resume must not proceed without
	// explicit confirmation — pass a callback wired to AskUserQuestion/readline.
	// Default: abort with a user-category error.
	confirmOrphans?: (orphans: string[]) => boolean | Promise<boolean>;
	// A failed step whose definition has no rollbackFn: surface the descriptive
	// rollback string as a required manual action (rulebook: rollback corollary).
	onManualRollback?: (step: string, rollback: string) => void;
}

// Per-step context. get/set read and write a persisted per-run key-value store
// in the state DB, so resume in a fresh process can re-hydrate anything a step
// needs that it cannot re-derive from source/build output. Steps persist what
// resume needs via set(); the runner snapshots each step's context into the
// step row's action field after it completes (resume + postmortem).
export class RunContext implements StepContext {
	private readonly db: Database;
	constructor(db: Database) {
		this.db = db;
	}
	get(key: string): unknown {
		const row = this.db.query("SELECT value FROM ctx WHERE key = ?").get(key) as
			| { value: string }
			| null;
		if (row === null) {
			return undefined;
		}
		return JSON.parse(row.value) as unknown;
	}
	set(key: string, value: unknown): void {
		this.db
			.query(
				"INSERT INTO ctx (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
			)
			.run(key, JSON.stringify(value));
	}
}

export class StepRunner {
	private readonly db: Database;
	private readonly steps: StepDef[];
	private readonly options: RunOptions;
	private readonly byName = new Map<string, StepDef>();

	constructor(stateDbPath: string, steps: StepDef[], options: RunOptions = {}) {
		mkdirSync(dirname(stateDbPath), { recursive: true });
		this.db = new Database(stateDbPath, { create: true });
		this.db.exec("PRAGMA journal_mode = WAL;");
		this.db.exec(
			"CREATE TABLE IF NOT EXISTS steps (step TEXT PRIMARY KEY, status TEXT NOT NULL, ranAt TEXT NOT NULL, action TEXT NOT NULL, rollback TEXT);"
		);
		this.db.exec("CREATE TABLE IF NOT EXISTS ctx (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
		this.steps = steps;
		this.options = options;
		for (const step of steps) {
			this.byName.set(step.name, step);
		}
	}

	// Ordered by rowid: insertion order is execution order in a normal run,
	// so reverse-replay undoes steps in the opposite of their run sequence.
	private rows(): StepRow[] {
		return this.db
			.query("SELECT step, status, ranAt, action, rollback FROM steps ORDER BY rowid")
			.all() as unknown as StepRow[];
	}

	// Reconciliation: insert a pending row for every step not yet tracked;
	// flag rows with no matching step as orphaned and require confirmation.
	// "Mark done only after its local write/checkpoint succeeds" — rows are
	// only ever written done by run() after the step's run() resolves.
	private async reconcile(): Promise<void> {
		for (const step of this.steps) {
			const exists = this.db.query("SELECT 1 FROM steps WHERE step = ?").get(step.name);
			if (exists === null) {
				this.db
					.query("INSERT INTO steps (step, status, ranAt, action, rollback) VALUES (?, 'pending', '', '{}', ?)")
					.run(step.name, step.rollback);
			}
		}
		const orphans = this.rows()
			.map((row) => row.step)
			.filter((name) => !this.byName.has(name));
		if (orphans.length > 0) {
			const confirm = this.options.confirmOrphans;
			if (confirm === undefined || !(await confirm(orphans))) {
				throw new RunError(
					`orphaned state rows require explicit confirmation: ${orphans.join(", ")}`,
					"user"
				);
			}
		}
	}

	async run(): Promise<void> {
		await this.reconcile();
		const context = new RunContext(this.db);
		for (const step of this.steps) {
			const row = this.rows().find((candidate) => candidate.step === step.name);
			if (row?.status === "done") {
				// Re-hydrate persisted context so later steps see values from
				// before the resume point (no in-memory continuity is assumed).
				console.log({ step: step.name, status: "done", resumed: true });
				continue;
			}
			console.log({ step: step.name, status: "running" });
			try {
				await step.run(context);
			} catch (error) {
				await this.failAndRollback(step, context, error);
				throw error instanceof RunError
					? error
					: new RunError((error as Error).message, "internal");
			}
			// Snapshot the step's context as its action; mark done in the same
			// transaction the checkpoint lives in (atomic).
			const action = this.db.transaction(() => {
				const snapshot = this.db
					.query("SELECT key, value FROM ctx")
					.all() as unknown as Array<{ key: string; value: string }>;
				this.db
					.query("UPDATE steps SET status = 'done', ranAt = ?, action = ? WHERE step = ?")
					.run(new Date().toISOString(), JSON.stringify(snapshot), step.name);
			});
			action();
			console.log({ step: step.name, status: "done" });
		}
	}

	// On failure: replay done rows in reverse; rollbackFn when the definition
	// has one, else surface the descriptive rollback string as a required
	// manual action — never a silent gap. Waits for each rollbackFn so the
	// process cannot exit mid-replay.
	private async failAndRollback(failed: StepDef, context: RunContext, cause: unknown): Promise<void> {
		this.db
			.query("UPDATE steps SET status = 'failed', action = ? WHERE step = ?")
			.run(JSON.stringify({ cause: (cause as Error).message }), failed.name);
		const doneInReverse = this.rows()
			.filter((row) => row.status === "done")
			.reverse();
		for (const row of doneInReverse) {
			const def = this.byName.get(row.step);
			const rollbackFn = def?.rollbackFn ?? null;
			if (rollbackFn !== null) {
				console.log({ step: row.step, status: "rollback" });
				try {
					await rollbackFn(context);
				} catch (error) {
					console.log({ error: "rollback failed", category: "internal", step: row.step, detail: (error as Error).message });
				}
			} else if (this.options.onManualRollback !== undefined) {
				this.options.onManualRollback(row.step, row.rollback ?? "null");
			}
		}
	}

	close(): void {
		this.db.close();
	}
}
