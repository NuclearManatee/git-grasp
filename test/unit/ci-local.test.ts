import { describe, it, expect, mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CI_AUDIT_SCRIPT,
  CI_STEPS,
  buildCiSteps,
  runCi,
  type CiStep,
  type RunStepArgs,
} from '../../common/scripts/ci.ts';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('buildCiSteps / CI_STEPS', () => {
  it('happy: ordered typecheck → test → audit with process.execPath argv prefix', () => {
    const bunBin = '/fake/bun';
    const steps = buildCiSteps(bunBin);
    expect(steps.map((s) => s.id)).toEqual(['typecheck', 'test', 'audit']);
    expect(steps[0].argv).toEqual([bunBin, 'run', 'typecheck']);
    expect(steps[1].argv).toEqual([bunBin, 'run', 'test']);
    expect(steps[2].argv).toEqual([bunBin, CI_AUDIT_SCRIPT]);
    expect(steps[0].env).toEqual({ GIT_GRASP_SKIP_POSTINSTALL: '1' });
    expect(steps[1].env).toEqual({
      GIT_GRASP_MOCK_EMBEDDINGS: '1',
      GIT_GRASP_SKIP_POSTINSTALL: '1',
    });
    expect(steps[2].env).toEqual({});
  });

  it('contract: CI_STEPS argv uses process.execPath as bun binary', () => {
    expect(CI_STEPS[0].argv[0]).toBe(process.execPath);
    expect(CI_STEPS.every((s) => s.argv[0] === process.execPath)).toBe(true);
  });
});

describe('runCi', () => {
  it('happy: all steps exit 0 → overall 0; invoked in order with step env', () => {
    const calls: RunStepArgs[] = [];
    const code = runCi({
      bunBin: 'bun-bin',
      runStep: (args) => {
        calls.push(args);
        return 0;
      },
      cwd: '/repo',
    });
    expect(code).toBe(0);
    expect(calls.map((c) => c.argv)).toEqual([
      ['bun-bin', 'run', 'typecheck'],
      ['bun-bin', 'run', 'test'],
      ['bun-bin', CI_AUDIT_SCRIPT],
    ]);
    expect(calls[0].env.GIT_GRASP_SKIP_POSTINSTALL).toBe('1');
    expect(calls[1].env.GIT_GRASP_MOCK_EMBEDDINGS).toBe('1');
    expect(calls[1].env.GIT_GRASP_SKIP_POSTINSTALL).toBe('1');
    expect(calls.every((c) => c.cwd === '/repo')).toBe(true);
  });

  it('edge: empty step list → 0 (no-op)', () => {
    const runStep = mock(() => 0);
    expect(runCi({ steps: [], runStep })).toBe(0);
    expect(runStep).not.toHaveBeenCalled();
  });

  it('edge: single-step subset via injected step list', () => {
    const steps: CiStep[] = [
      { id: 'only', argv: ['x', 'y'], env: { A: '1' } },
    ];
    const calls: RunStepArgs[] = [];
    expect(
      runCi({
        steps,
        runStep: (a) => {
          calls.push(a);
          return 0;
        },
      }),
    ).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0].argv).toEqual(['x', 'y']);
    expect(calls[0].env.A).toBe('1');
  });

  it('edge: caller env merged without dropping step env', () => {
    const calls: RunStepArgs[] = [];
    runCi({
      bunBin: 'b',
      env: { FROM_CALLER: 'yes', GIT_GRASP_SKIP_POSTINSTALL: '0' },
      runStep: (a) => {
        calls.push(a);
        return 0;
      },
    });
    // step env wins over caller for the same key
    expect(calls[0].env.FROM_CALLER).toBe('yes');
    expect(calls[0].env.GIT_GRASP_SKIP_POSTINSTALL).toBe('1');
    expect(calls[1].env.FROM_CALLER).toBe('yes');
    expect(calls[1].env.GIT_GRASP_MOCK_EMBEDDINGS).toBe('1');
  });

  it('negative: typecheck ≠0 → test/audit not run, return that code', () => {
    const calls: string[][] = [];
    const code = runCi({
      bunBin: 'b',
      runStep: (a) => {
        calls.push(a.argv);
        if (a.argv.includes('typecheck')) return 7;
        return 0;
      },
    });
    expect(code).toBe(7);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('typecheck');
  });

  it('negative: test ≠0 → audit skipped', () => {
    const ids: string[] = [];
    const steps = buildCiSteps('b');
    const code = runCi({
      steps,
      runStep: (a) => {
        const step = steps.find((s) => s.argv.join(' ') === a.argv.join(' '));
        ids.push(step?.id ?? '?');
        if (step?.id === 'test') return 3;
        return 0;
      },
    });
    expect(code).toBe(3);
    expect(ids).toEqual(['typecheck', 'test']);
  });

  it('negative: audit ≠0 → overall ≠0', () => {
    const code = runCi({
      bunBin: 'b',
      runStep: (a) => (a.argv.includes(CI_AUDIT_SCRIPT) ? 2 : 0),
    });
    expect(code).toBe(2);
  });

  it('fault: runStep throws → propagates', () => {
    expect(() =>
      runCi({
        steps: [{ id: 'boom', argv: ['x'], env: {} }],
        runStep: () => {
          throw new Error('spawn failed');
        },
      }),
    ).toThrow(/spawn failed/);
  });

  it('fault: non-zero with stderr still fail-fast (no later steps)', () => {
    const calls: string[] = [];
    const steps = buildCiSteps('b');
    runCi({
      steps,
      runStep: (a) => {
        const id = steps.find((s) => s.argv.join(' ') === a.argv.join(' '))?.id;
        calls.push(id ?? '?');
        // simulate failure that also wrote stderr (stdio inherit — code is what matters)
        if (id === 'typecheck') return 1;
        return 0;
      },
    });
    expect(calls).toEqual(['typecheck']);
  });

  it('fault: does not invent argv — exact CI_STEPS argv only', () => {
    const steps = buildCiSteps('/exact/bun');
    const seen: string[][] = [];
    runCi({
      steps,
      runStep: (a) => {
        seen.push(a.argv);
        return 0;
      },
    });
    expect(seen).toEqual(steps.map((s) => s.argv));
  });
});

describe('workflow contract', () => {
  it('ci.yml invokes bun run ci and does not inline gate steps', () => {
    const yml = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');
    expect(yml).toMatch(/bun run ci/);
    expect(yml).not.toMatch(/bun run typecheck/);
    expect(yml).not.toMatch(/bun run test\b/);
    expect(yml).not.toMatch(/ci-audit\.ts/);
  });

  it('package.json exposes ci script', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.scripts.ci).toBe('bun common/scripts/ci.ts');
  });
});
