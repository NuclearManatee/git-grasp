#!/usr/bin/env bun
/**
 * Local / Actions CI gate: typecheck → test → audit (fail-fast).
 * Install stays in the workflow; this assumes deps are present.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export type CiStep = {
  id: string;
  argv: string[];
  env: Record<string, string>;
};

export type RunStepArgs = {
  argv: string[];
  env: Record<string, string>;
  cwd: string;
};

export type RunCiDeps = {
  bunBin?: string;
  steps?: CiStep[];
  runStep?: (args: RunStepArgs) => number;
  cwd?: string;
  env?: Record<string, string>;
};

/** Audit script path relative to repo root (stable argv for contracts). */
export const CI_AUDIT_SCRIPT = path.join('common', 'scripts', 'ci-audit.ts');

export function buildCiSteps(bunBin: string = process.execPath): CiStep[] {
  return [
    {
      id: 'typecheck',
      argv: [bunBin, 'run', 'typecheck'],
      env: { GIT_GRASP_SKIP_POSTINSTALL: '1' },
    },
    {
      id: 'test',
      argv: [bunBin, 'run', 'test'],
      env: {
        GIT_GRASP_MOCK_EMBEDDINGS: '1',
        GIT_GRASP_SKIP_POSTINSTALL: '1',
      },
    },
    {
      id: 'audit',
      argv: [bunBin, CI_AUDIT_SCRIPT],
      env: {},
    },
  ];
}

/** Default step list using the current process binary (bun when launched via bun). */
export const CI_STEPS = buildCiSteps();

export function defaultRunStep({ argv, env, cwd }: RunStepArgs): number {
  const [cmd, ...args] = argv;
  const result = spawnSync(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/**
 * Fail-fast CI gate. Returns the first non-zero step exit code, or 0 on success.
 * Throws if `runStep` throws (CLI maps that to exit 1).
 */
export function runCi(deps: RunCiDeps = {}): number {
  const bunBin = deps.bunBin ?? process.execPath;
  const steps = deps.steps ?? buildCiSteps(bunBin);
  const runStep = deps.runStep ?? defaultRunStep;
  const cwd = deps.cwd ?? process.cwd();
  const extraEnv = deps.env ?? {};

  for (const step of steps) {
    const code = runStep({
      argv: step.argv,
      env: { ...extraEnv, ...step.env },
      cwd,
    });
    if (code !== 0) return code;
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(runCi());
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
