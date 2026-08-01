import { describe, it, expect, vi } from 'vitest';
import {
  parseAuditOutput,
  collectFindings,
  evaluateAuditGate,
  formatUnexpected,
  formatAllowedHighs,
  runAuditGate,
} from '../../common/scripts/ci-audit.ts';

describe('parseAuditOutput', () => {
  it('happy: parses plain JSON object', () => {
    expect(parseAuditOutput('{}')).toEqual({});
  });

  it('edge: strips version banner before JSON', () => {
    const out = 'bun v1.3.14\n{"lodash":[{"severity":"low"}]}\n';
    expect(parseAuditOutput(out)).toEqual({
      lodash: [{ severity: 'low' }],
    });
  });

  it('fault: non-JSON / no { → throws', () => {
    expect(() => parseAuditOutput('not json at all')).toThrow(
      /Could not parse bun audit JSON/,
    );
  });

  it('fault: truncated JSON → throws', () => {
    expect(() => parseAuditOutput('{')).toThrow(/Could not parse bun audit JSON/);
  });
});

describe('collectFindings', () => {
  it('happy: flattens package advisory arrays', () => {
    expect(
      collectFindings({
        foo: [{ severity: 'high', title: 'A' }],
        bar: [{ severity: 'low' }],
      }),
    ).toEqual([
      ['foo', { severity: 'high', title: 'A' }],
      ['bar', { severity: 'low' }],
    ]);
  });

  it('edge: empty advisory array contributes nothing', () => {
    expect(collectFindings({ foo: [] })).toEqual([]);
  });

  it('fault: non-array advisory value skipped (no crash)', () => {
    expect(
      collectFindings({
        bad: 'oops',
        ok: [{ severity: 'moderate' }],
      }),
    ).toEqual([['ok', { severity: 'moderate' }]]);
  });

  it('fault: non-object report → empty', () => {
    expect(collectFindings(null)).toEqual([]);
    expect(collectFindings('x')).toEqual([]);
  });
});

describe('evaluateAuditGate', () => {
  it('happy: empty findings → ok', () => {
    const r = evaluateAuditGate([]);
    expect(r.ok).toBe(true);
    expect(r.unexpected).toEqual([]);
    expect(r.highs).toEqual([]);
  });

  it('happy: only moderate/low → ok', () => {
    const r = evaluateAuditGate([
      ['a', { severity: 'moderate' }],
      ['b', { severity: 'low' }],
    ]);
    expect(r.ok).toBe(true);
    expect(r.highs).toEqual([]);
  });

  it('edge: allowlisted high → ok + allowedHighs', () => {
    const r = evaluateAuditGate(
      [['left-pad', { severity: 'high', id: 'GHSA-1' }]],
      new Set(['left-pad']),
    );
    expect(r.ok).toBe(true);
    expect(r.allowedHighs).toHaveLength(1);
    expect(r.unexpected).toEqual([]);
  });

  it('edge: mixed severities with only moderate high-band absent → ok', () => {
    const r = evaluateAuditGate([
      ['x', { severity: 'moderate' }],
      ['y', { severity: 'low' }],
      ['z', { severity: 'info' as string }],
    ]);
    expect(r.ok).toBe(true);
  });

  it('negative: high not allowlisted → ok false', () => {
    const r = evaluateAuditGate([['evil', { severity: 'high', title: 'RCE' }]]);
    expect(r.ok).toBe(false);
    expect(r.unexpected).toHaveLength(1);
  });

  it('negative: critical → fail', () => {
    const r = evaluateAuditGate([['evil', { severity: 'critical' }]]);
    expect(r.ok).toBe(false);
  });

  it('negative: allowlist miss (different package name) → fail', () => {
    const r = evaluateAuditGate(
      [['other-pkg', { severity: 'high' }]],
      new Set(['left-pad']),
    );
    expect(r.ok).toBe(false);
  });

  it('fault: missing severity → not treated as high', () => {
    const r = evaluateAuditGate([['x', { title: 'weird' }]]);
    expect(r.ok).toBe(true);
    expect(r.highs).toEqual([]);
  });
});

describe('format helpers', () => {
  it('fault: title/id/severity fallbacks in unexpected message', () => {
    expect(
      formatUnexpected([
        ['a', { title: 'T', id: 'I', severity: 'high' }],
        ['b', { id: 'I2', severity: 'high' }],
        ['c', { severity: 'critical' }],
      ]),
    ).toEqual(['a (T)', 'b (I2)', 'c (critical)']);
  });

  it('formats allowed highs with id/title/severity fallback', () => {
    expect(
      formatAllowedHighs([
        ['a', { id: '1', title: 'T' }],
        ['b', { title: 'OnlyTitle' }],
        ['c', { severity: 'high' }],
      ]),
    ).toBe('a:1, b:OnlyTitle, c:high');
  });
});

describe('runAuditGate', () => {
  it('happy: empty report → pass + log', () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const code = runAuditGate({
      runAudit: () => '{}',
      log,
    });
    expect(code).toBe(0);
    expect(log.log).toHaveBeenCalledWith('Audit gate passed');
    expect(log.error).not.toHaveBeenCalled();
  });

  it('happy: only moderate → pass', () => {
    const code = runAuditGate({
      runAudit: () =>
        JSON.stringify({ pkg: [{ severity: 'moderate', title: 'm' }] }),
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(code).toBe(0);
  });

  it('edge: allowlisted high warns and passes', () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const code = runAuditGate({
      runAudit: () =>
        JSON.stringify({
          'left-pad': [{ severity: 'high', id: 'GHSA-x' }],
        }),
      allowed: new Set(['left-pad']),
      log,
    });
    expect(code).toBe(0);
    expect(log.warn).toHaveBeenCalled();
    expect(log.log).toHaveBeenCalledWith('Audit gate passed');
  });

  it('edge: banner before JSON still evaluates', () => {
    const code = runAuditGate({
      runAudit: () => 'bun 1.3\n{}',
      log: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    expect(code).toBe(0);
  });

  it('negative: unexpected high → exit 1', () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const code = runAuditGate({
      runAudit: () =>
        JSON.stringify({ evil: [{ severity: 'high', title: 'RCE' }] }),
      log,
    });
    expect(code).toBe(1);
    expect(log.error).toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });

  it('fault: runAudit throws with empty stdout → parse fail exit 1', () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const code = runAuditGate({
      runAudit: () => {
        const err = new Error('audit failed') as Error & { stdout?: string };
        err.stdout = '';
        throw err;
      },
      log,
    });
    expect(code).toBe(1);
    expect(log.error).toHaveBeenCalledWith('Could not parse bun audit JSON');
  });

  it('fault: runAudit throws but stdout has JSON → still evaluate', () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const code = runAuditGate({
      runAudit: () => {
        const err = new Error('non-zero') as Error & { stdout?: string };
        err.stdout = JSON.stringify({
          evil: [{ severity: 'critical', title: 'bad' }],
        });
        throw err;
      },
      log,
    });
    expect(code).toBe(1);
    expect(log.error.mock.calls[0][0]).toMatch(/Unexpected high\/critical/);
  });

  it('fault: runAudit throws with Buffer stdout → still evaluate pass', () => {
    const log = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const code = runAuditGate({
      runAudit: () => {
        const err = new Error('non-zero') as Error & { stdout?: Buffer };
        err.stdout = Buffer.from('{}');
        throw err;
      },
      log,
    });
    expect(code).toBe(0);
    expect(log.log).toHaveBeenCalledWith('Audit gate passed');
  });
});
